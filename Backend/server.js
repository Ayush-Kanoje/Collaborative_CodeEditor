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
import { executeCode } from "./executionService.js"

const PRESENCE_ROOM = "collaborator-presence-v1"
const CODE_ROOM_PREFIX = "personal-code-v1:"
const PRESENCE_REMOVAL_GRACE_MS = 20_000
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/

const app = express()
app.use(express.static("public"))
app.use(express.json({ limit: "110kb" }))

const httpServer = createServer(app)

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
})

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

function getOrCreateDocument(roomName, namespace) {
    const existingDocument = documents.get(roomName)

    if (existingDocument) {
        return existingDocument
    }

    const document = new Document(roomName, namespace)
    const socketClientIds = new Map()

    document.awareness.on("update", ({ added, updated, removed }, origin) => {
        if (!origin?.id) {
            return
        }

        const clientIds = socketClientIds.get(origin.id) || new Set()
        added.concat(updated).forEach((clientId) => clientIds.add(clientId))
        removed.forEach((clientId) => clientIds.delete(clientId))
        socketClientIds.set(origin.id, clientIds)
    })

    const collaborationDocument = { document, socketClientIds }
    documents.set(roomName, collaborationDocument)
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

collaborationNamespaces.on("connection", (socket) => {
    const roomName = socket.nsp.name.replace(/^\/yjs\|/, "")
    const { document, socketClientIds } = getOrCreateDocument(roomName, socket.nsp)
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

app.get("/health", (req, res) => {
    res.status(200).json({
        message: "ok",
        success: true,
    })
})

// Keep execution in the existing Docker service; this route only exposes it to
// the browser and derives the rate-limit identity from a validated username.
app.post("/execute", async (req, res) => {
    const username = normalizeUsername(req.body?.username)

    if (!username) {
        res.status(400).json({
            status: "failed",
            error: "A valid username is required.",
            stdout: "",
            stderr: "",
            exitCode: -1,
            durationMs: 0,
        })
        return
    }

    const result = await executeCode({
        code: req.body?.code,
        language: "python",
        userId: getUserId(username),
    })

    res.status(result.status === "failed" && result.error?.startsWith("Code must") ? 400 : 200).json(result)
})

httpServer.listen(3000, () => {
    console.log("Server is running on port 3000")
})
