import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import { Document } from "y-socket.io/dist/server"
import * as Y from "yjs"
import {
    applyAwarenessUpdate,
    encodeAwarenessUpdate,
    modifyAwarenessUpdate,
    removeAwarenessStates,
} from "y-protocols/awareness"
import { createTraceRouter, traceRequestErrorHandler } from "./routes/traceRoutes.js"
import { shutdownTraceProcesses } from "./services/pythonTraceService.js"
import logger, { logError, logSocketEvent } from "./utils/logger.js"
import {
    PORT,
    CORS_ORIGIN,
    CORS_ORIGINS,
    CORS_METHODS,
    CORS_ALLOW_HEADERS,
    PRESENCE_REMOVAL_GRACE_MS,
    SHUTDOWN_TIMEOUT_MS,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_PASSWORD,
    REDIS_DB,
    YJS_PERSISTENCE_ENABLED,
    YJS_STORAGE_BACKEND,
    AWS_REGION,
    S3_BUCKET,
    S3_ENDPOINT,
    DYNAMODB_TABLE,
    DYNAMODB_TTL_DAYS,
    validateConfig,
    printConfig,
} from "./config/env.js"
import {
    livenessHandler,
    readinessHandler,
    legacyHealthHandler,
    markReady,
    markNotReady,
    markShuttingDown,
    setRedisClients,
} from "./middleware/healthCheck.js"
import {
    createRedisClients,
    setupRedisAdapter,
    closeRedisClients,
} from "./services/redisAdapter.js"
import {
    loadDocument,
    scheduleSave,
    saveAllDocuments,
    cancelAllPendingSaves,
} from "./services/yjsPersistence.js"

// Validate configuration on startup
try {
    validateConfig()
    printConfig()
} catch (error) {
    logError(error, { phase: "startup" }, "Configuration validation failed")
    process.exit(1)
}

const PRESENCE_ROOM = "collaborator-presence-v1"
const CODE_ROOM_PREFIX = "personal-code-v1:"
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/

const app = express()

// Health check endpoints (registered early, before CORS)
app.get("/health", legacyHealthHandler) // Legacy endpoint
app.get("/healthz", livenessHandler) // Kubernetes-style liveness
app.get("/readyz", readinessHandler) // Kubernetes-style readiness

// CORS middleware with environment-driven configuration
app.use((req, res, next) => {
    const requestOrigin = req.headers.origin
    if (!requestOrigin) {
        next()
        return
    }

    // Check if origin is allowed (support multiple origins)
    const isAllowed = CORS_ORIGINS.some((allowed) => {
        // Support wildcards in development
        if (allowed === "*") return true
        // Exact match
        if (allowed === requestOrigin) return true
        // Pattern match (e.g., *.example.com)
        if (allowed.startsWith("*.")) {
            const domain = allowed.slice(2)
            return requestOrigin.endsWith(domain)
        }
        return false
    })

    if (!isAllowed) {
        res.status(403).json({ error: "Origin is not allowed" })
        return
    }

    res.setHeader("Access-Control-Allow-Origin", requestOrigin)
    res.setHeader("Access-Control-Allow-Methods", CORS_METHODS.join(","))
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS.join(","))
    res.setHeader("Vary", "Origin")

    if (req.method === "OPTIONS") {
        res.sendStatus(204)
        return
    }
    next()
})
app.use(express.static("public"))
app.use(express.json({ limit: "110kb" }))
app.use("/api", createTraceRouter())
app.use(traceRequestErrorHandler)

const httpServer = createServer(app)

const io = new Server(httpServer, {
    cors: {
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl)
            if (!origin) return callback(null, true)

            // Check if origin is allowed
            const isAllowed = CORS_ORIGINS.some((allowed) => {
                if (allowed === "*") return true
                if (allowed === origin) return true
                if (allowed.startsWith("*.")) {
                    const domain = allowed.slice(2)
                    return origin.endsWith(domain)
                }
                return false
            })

            if (isAllowed) {
                callback(null, true)
            } else {
                callback(new Error("Not allowed by CORS"))
            }
        },
        methods: CORS_METHODS,
    },
})

// Initialize Redis adapter if configured (enables horizontal scaling)
let redisClients = null
if (REDIS_HOST) {
    logger.info({ host: REDIS_HOST, port: REDIS_PORT }, "Initializing Redis adapter")
    try {
        redisClients = await createRedisClients(REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB)
        setupRedisAdapter(io, redisClients.pubClient, redisClients.subClient)
        // Pass Redis clients to health check middleware for dependency checking
        setRedisClients(redisClients)
    } catch (error) {
        logError(error, { component: "redis" }, "Failed to initialize Redis adapter")
        logger.warn("Continuing without Redis adapter (single-server mode)")
    }
} else {
    logger.info("Redis adapter not configured (single-server mode)")
}

// Yjs persistence configuration
const persistenceConfig = YJS_PERSISTENCE_ENABLED
    ? {
          s3:
              YJS_STORAGE_BACKEND === "s3" && S3_BUCKET
                  ? {
                        bucket: S3_BUCKET,
                        region: AWS_REGION,
                        ...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
                    }
                  : null,
          dynamodb:
              YJS_STORAGE_BACKEND === "dynamodb"
                  ? {
                        table: DYNAMODB_TABLE,
                        region: AWS_REGION,
                        ttlDays: DYNAMODB_TTL_DAYS,
                    }
                  : null,
      }
    : null

if (YJS_PERSISTENCE_ENABLED) {
    logger.info({ backend: YJS_STORAGE_BACKEND }, "Yjs persistence enabled")
} else {
    logger.info("Yjs persistence disabled (in-memory only)")
}

const documents = new Map()
const presenceSocketsByUser = new Map()
const pendingPresenceRemovals = new Map()
const inactivePresenceClientIdsByUser = new Map()

function cancelPendingPresenceRemoval(userId) {
    const pendingRemoval = pendingPresenceRemovals.get(userId)
    if (!pendingRemoval) return

    clearTimeout(pendingRemoval.timer)
    pendingPresenceRemovals.delete(userId)
}

function schedulePresenceRemoval(userId, document, clientIds) {
    const existingRemoval = pendingPresenceRemovals.get(userId)
    const pendingClientIds = inactivePresenceClientIdsByUser.get(userId) || new Set()
    clientIds.forEach((clientId) => pendingClientIds.add(clientId))
    inactivePresenceClientIdsByUser.set(userId, pendingClientIds)
    if (existingRemoval) clearTimeout(existingRemoval.timer)

    const timer = setTimeout(() => {
        pendingPresenceRemovals.delete(userId)
        if (presenceSocketsByUser.get(userId)?.size) return

        // This is awareness/presence only; code documents are never deleted.
        if (pendingClientIds.size) {
            removeAwarenessStates(document.awareness, [...pendingClientIds], "presence grace period expired")
        }
        inactivePresenceClientIdsByUser.delete(userId)
    }, PRESENCE_REMOVAL_GRACE_MS)
    timer.unref?.()
    pendingPresenceRemovals.set(userId, { timer, clientIds: pendingClientIds })
}

function clearPresenceRemovalTimers() {
    pendingPresenceRemovals.forEach(({ timer }) => clearTimeout(timer))
    pendingPresenceRemovals.clear()
    inactivePresenceClientIdsByUser.clear()
}

function normalizeUsername(value) {
    if (typeof value !== "string") {
        return ""
    }

    const username = value.normalize("NFKC").replace(/\s+/g, " ").trim()
    return USERNAME_PATTERN.test(username) ? username : ""
}

function getUserId(username) {
    return normalizeUsername(username).toLowerCase()
}

function getPersonalCodeRoom(username) {
    return `${CODE_ROOM_PREFIX}${encodeURIComponent(getUserId(username))}`
}

function getRoomDetails(roomName) {
    if (roomName === PRESENCE_ROOM) {
        return { type: "presence" }
    }

    if (!roomName.startsWith(CODE_ROOM_PREFIX)) {
        return null
    }

    try {
        const ownerId = decodeURIComponent(roomName.slice(CODE_ROOM_PREFIX.length))
        return getPersonalCodeRoom(ownerId) === roomName && ownerId
            ? { type: "code", ownerId }
            : null
    } catch {
        return null
    }
}

function getClientIdentity(auth) {
    const username = normalizeUsername(auth?.username)
    const sessionId = typeof auth?.sessionId === "string" ? auth.sessionId : ""

    if (!username || !SESSION_ID_PATTERN.test(sessionId)) {
        return null
    }

    return { username, userId: getUserId(username), sessionId }
}

function toUint8Array(value) {
    return value instanceof Uint8Array ? value : new Uint8Array(value)
}

async function getOrCreateDocument(roomName, namespace) {
    const existingDocument = documents.get(roomName)

    if (existingDocument) {
        return existingDocument
    }

    const document = new Document(roomName, namespace)
    const socketClientIds = new Map()
    const collaborationDocument = { document, socketClientIds }
    documents.set(roomName, collaborationDocument)

    // Load persisted state if enabled
    if (persistenceConfig && roomName !== PRESENCE_ROOM) {
        try {
            const loaded = await loadDocument(roomName, document, persistenceConfig)
            if (loaded) {
                logger.info({ room: roomName }, "Loaded persisted state for room")
            }
        } catch (error) {
            logError(error, { room: roomName, component: "persistence" }, "Failed to load persisted state")
        }
    }

    // Setup persistence: auto-save on document updates
    if (persistenceConfig && roomName !== PRESENCE_ROOM) {
        document.on("update", () => {
            // Debounced save - triggered after edits stop
            scheduleSave(roomName, document, persistenceConfig)
        })
    }

    document.awareness.on("update", ({ added, updated, removed }, origin) => {
        if (!origin?.id) {
            return
        }

        const clientIds = socketClientIds.get(origin.id) || new Set()
        added.concat(updated).forEach((clientId) => clientIds.add(clientId))
        removed.forEach((clientId) => clientIds.delete(clientId))
        socketClientIds.set(origin.id, clientIds)
    })

    return collaborationDocument
}

const collaborationNamespaces = io.of(/^\/yjs\|.*$/)

collaborationNamespaces.use((socket, next) => {
    const roomName = socket.nsp.name.replace(/^\/yjs\|/, "")
    const roomDetails = getRoomDetails(roomName)
    const identity = getClientIdentity(socket.handshake.auth)

    if (!roomDetails || !identity) {
        next(new Error("Unauthorized"))
        return
    }

    const isOwner = roomDetails.type === "code" && roomDetails.ownerId === identity.userId
    const isViewer = roomDetails.type === "code" && socket.handshake.auth?.access === "view"
    const canConnect = roomDetails.type === "presence"
        ? socket.handshake.auth?.access === "presence"
        : isOwner || isViewer

    if (!canConnect) {
        next(new Error("Unauthorized"))
        return
    }

    socket.data.identity = identity
    socket.data.canWrite = isOwner
    next()
})

collaborationNamespaces.on("connection", async (socket) => {
    const roomName = socket.nsp.name.replace(/^\/yjs\|/, "")
    const { document, socketClientIds } = await getOrCreateDocument(roomName, socket.nsp)
    const isPresenceConnection = roomName === PRESENCE_ROOM

    if (isPresenceConnection) {
        const { userId } = socket.data.identity
        const userSockets = presenceSocketsByUser.get(userId) || new Set()
        userSockets.add(socket.id)
        presenceSocketsByUser.set(userId, userSockets)
        cancelPendingPresenceRemoval(userId)
    }

    socket.on("sync-step-1", (stateVector, acknowledge) => {
        if (typeof acknowledge !== "function") {
            return
        }

        try {
            acknowledge(Y.encodeStateAsUpdate(document, toUint8Array(stateVector)))
        } catch {
            acknowledge(new Uint8Array())
        }
    })

    socket.on("sync-update", (update) => {
        if (!socket.data.canWrite) {
            return
        }

        try {
            Y.applyUpdate(document, toUint8Array(update), socket)
        } catch {
            // Invalid synchronization data is ignored without affecting other collaborators.
        }
    })

    socket.on("awareness-update", (update) => {
        try {
            const identity = socket.data.identity
            const trustedUpdate = modifyAwarenessUpdate(
                toUint8Array(update),
                (state) => state === null ? null : { ...state, user: identity },
            )
            applyAwarenessUpdate(document.awareness, trustedUpdate, socket)
        } catch {
            // Invalid awareness data is ignored without affecting the shared presence list.
        }
    })

    socket.emit("sync-step-1", Y.encodeStateVector(document), (update) => {
        if (!socket.data.canWrite) {
            return
        }

        try {
            Y.applyUpdate(document, toUint8Array(update), socket)
        } catch {
            // A malformed initial update must not prevent future synchronization.
        }
    })
    socket.emit(
        "awareness-update",
        encodeAwarenessUpdate(document.awareness, Array.from(document.awareness.getStates().keys())),
    )

    socket.on("disconnect", () => {
        const clientIds = socketClientIds.get(socket.id)

        if (!isPresenceConnection && clientIds?.size) {
            removeAwarenessStates(document.awareness, [...clientIds], socket)
        }

        if (isPresenceConnection) {
            const { userId } = socket.data.identity
            const userSockets = presenceSocketsByUser.get(userId)
            userSockets?.delete(socket.id)
            if (!userSockets?.size) {
                presenceSocketsByUser.delete(userId)
                schedulePresenceRemoval(userId, document, clientIds || new Set())
            }
        }

        socketClientIds.delete(socket.id)
    })
})

httpServer.on("close", clearPresenceRemovalTimers)

let shuttingDown = false
async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, "Received shutdown signal, shutting down gracefully")

    // Mark as not ready immediately (stop accepting new traffic)
    markShuttingDown()

    // Save all documents before shutdown
    if (persistenceConfig) {
        try {
            await saveAllDocuments(documents, persistenceConfig)
        } catch (error) {
            logError(error, { phase: "shutdown" }, "Error saving documents on shutdown")
        }
    }

    // Cancel any pending saves
    cancelAllPendingSaves()

    // Clean up resources
    clearPresenceRemovalTimers()
    shutdownTraceProcesses()

    // Close Redis connections if configured
    if (redisClients) {
        try {
            await closeRedisClients(redisClients.pubClient, redisClients.subClient)
        } catch (error) {
            logError(error, { component: "redis" }, "Error closing Redis connections")
        }
    }

    // Close Socket.IO server (stops accepting new connections)
    io.close()

    // Close HTTP server with timeout
    const shutdownTimer = setTimeout(() => {
        logger.error("Graceful shutdown timeout exceeded, forcing exit")
        process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    shutdownTimer.unref()

    httpServer.close((error) => {
        clearTimeout(shutdownTimer)
        if (error) {
            logError(error, { phase: "shutdown" }, "Graceful shutdown failed")
            process.exitCode = 1
        } else {
            logger.info("Graceful shutdown completed successfully")
        }
        process.exit()
    })
}

process.once("SIGTERM", () => shutdown("SIGTERM"))
process.once("SIGINT", () => shutdown("SIGINT"))

// Start server
httpServer.listen(PORT, () => {
    logger.info(
        {
            port: PORT,
            environment: process.env.NODE_ENV || "development",
            corsOrigin: CORS_ORIGIN,
        },
        "Server started successfully",
    )

    // Mark server as ready after successful startup
    markReady()
    logger.info("Server is ready to accept traffic")
})
