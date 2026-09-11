/**
 * Redis Adapter for Socket.IO
 * 
 * PURPOSE: Enable horizontal scaling of Socket.IO across multiple server instances
 * 
 * WHY REDIS ADAPTER IS NEEDED:
 * ============================
 * 
 * Without Redis Adapter (Single Process):
 * ----------------------------------------
 * - All Socket.IO connections handled by ONE server process
 * - Emitting to a room broadcasts ONLY to sockets connected to THAT process
 * - Cannot scale horizontally (adding more servers doesn't help)
 * - Single point of failure
 * 
 * Example without Redis:
 * ```
 * Server 1 (PID 1001):
 *   - User A connected to room "code-alice"
 *   - User B connected to room "code-alice"
 * 
 * io.to("code-alice").emit("update", data)
 * ✓ User A receives update (on same server)
 * ✓ User B receives update (on same server)
 * 
 * Server 2 (PID 1002):
 *   - User C connected to room "code-alice"
 * 
 * ✗ User C does NOT receive update (on different server)
 * ```
 * 
 * With Redis Adapter (Multiple Processes):
 * -----------------------------------------
 * - Multiple Socket.IO servers can run in parallel
 * - Redis Pub/Sub synchronizes events across ALL servers
 * - Emitting to a room broadcasts to ALL connected sockets, regardless of which server
 * - Horizontal scaling works correctly
 * - No single point of failure
 * 
 * Example with Redis:
 * ```
 * Server 1 (PID 1001):
 *   - User A, User B connected
 *   - Emits to room "code-alice"
 *   - Publishes message to Redis
 * 
 * Redis Pub/Sub:
 *   - Broadcasts to ALL subscribed servers
 * 
 * Server 2 (PID 1002):
 *   - User C connected
 *   - Receives message from Redis
 *   - Emits to local User C
 * 
 * ✓ All users (A, B, C) receive update regardless of server!
 * ```
 * 
 * HOW IT WORKS:
 * =============
 * 
 * 1. Each server instance creates TWO Redis connections:
 *    - Publisher (pub): Sends events to other servers
 *    - Subscriber (sub): Receives events from other servers
 * 
 * 2. When emitting to a room:
 *    a. Server emits to local sockets in that room (in-memory)
 *    b. Server publishes event to Redis channel (cross-server)
 *    c. All other servers receive event from Redis
 *    d. Other servers emit to their local sockets in that room
 * 
 * 3. Redis channels used:
 *    - socket.io#<namespace>#<room>: Room-specific events
 *    - socket.io-adapter#<uid>#: Server-to-server communication
 * 
 * BENEFITS:
 * =========
 * - ✅ Horizontal scaling: Add more servers as traffic grows
 * - ✅ Load balancing: Distribute connections across servers
 * - ✅ High availability: If one server dies, others continue
 * - ✅ Zero downtime deploys: Roll out new versions gradually
 * - ✅ Room broadcasts work across all servers
 * - ✅ User presence synchronized across servers
 * 
 * TRADEOFFS:
 * ==========
 * - ❌ Requires Redis infrastructure (additional complexity)
 * - ❌ Slight latency increase (network hop through Redis)
 * - ❌ Redis becomes a dependency (but can be made highly available)
 * - ❌ Increased network traffic (events published to Redis)
 * 
 * WHEN TO USE:
 * ============
 * - Multiple server instances (Kubernetes, ECS with >1 task)
 * - Load balanced deployment (ALB, NLB)
 * - High availability requirements
 * - Horizontal scaling needs
 * 
 * WHEN NOT TO USE:
 * ===============
 * - Single server instance (no horizontal scaling)
 * - Development environment (adds complexity)
 * - Very low latency requirements (Redis adds ~1-5ms)
 */

import { createClient } from "redis"
import { createAdapter } from "@socket.io/redis-adapter"

/**
 * Create Redis clients for Socket.IO adapter
 * 
 * @param {string} host - Redis host (e.g., "localhost", "redis.example.com")
 * @param {number} port - Redis port (default: 6379)
 * @param {string} password - Redis password (optional)
 * @param {number} db - Redis database number (default: 0)
 * @returns {Promise<{pubClient: RedisClient, subClient: RedisClient}>}
 */
export async function createRedisClients(host, port = 6379, password = null, db = 0) {
    const options = {
        socket: {
            host,
            port,
            // Reconnect on connection loss
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.error("Redis connection failed after 10 retries")
                    return new Error("Redis connection failed")
                }
                // Exponential backoff: 100ms, 200ms, 400ms, 800ms, ...
                const delay = Math.min(retries * 100, 3000)
                console.log(`Redis reconnecting in ${delay}ms (attempt ${retries})`)
                return delay
            },
        },
        database: db,
    }

    if (password) {
        options.password = password
    }

    // Create publisher client
    const pubClient = createClient(options)

    // Create subscriber client (must be separate connection)
    const subClient = pubClient.duplicate()

    // Error handlers
    pubClient.on("error", (err) => {
        import("../utils/logger.js").then(({ logError }) => {
            logError(err, { client: "pub", component: "redis" }, "Redis pub client error")
        })
    })

    subClient.on("error", (err) => {
        import("../utils/logger.js").then(({ logError }) => {
            logError(err, { client: "sub", component: "redis" }, "Redis sub client error")
        })
    })

    // Connection event handlers
    pubClient.on("connect", () => {
        import("../utils/logger.js").then(({ default: logger }) => {
            logger.info({ client: "pub", component: "redis" }, "Redis pub client connected")
        })
    })

    subClient.on("connect", () => {
        import("../utils/logger.js").then(({ default: logger }) => {
            logger.info({ client: "sub", component: "redis" }, "Redis sub client connected")
        })
    })

    pubClient.on("ready", () => {
        import("../utils/logger.js").then(({ default: logger }) => {
            logger.info({ client: "pub", component: "redis" }, "Redis pub client ready")
        })
    })

    subClient.on("ready", () => {
        import("../utils/logger.js").then(({ default: logger }) => {
            logger.info({ client: "sub", component: "redis" }, "Redis sub client ready")
        })
    })

    // Connect both clients
    await Promise.all([pubClient.connect(), subClient.connect()])

    return { pubClient, subClient }
}

/**
 * Setup Socket.IO Redis adapter
 * 
 * @param {Server} io - Socket.IO server instance
 * @param {RedisClient} pubClient - Redis publisher client
 * @param {RedisClient} subClient - Redis subscriber client
 */
export function setupRedisAdapter(io, pubClient, subClient) {
    import("../utils/logger.js").then(({ default: logger }) => {
        const adapter = createAdapter(pubClient, subClient)

        io.adapter(adapter)

        logger.info("Socket.IO Redis adapter configured")
        logger.info("Multi-server scaling enabled")

        // Monitor adapter for debugging
        io.of("/").adapter.on("create-room", (room) => {
            logger.debug({ room, category: "redis-adapter" }, "Room created")
        })

        io.of("/").adapter.on("delete-room", (room) => {
            logger.debug({ room, category: "redis-adapter" }, "Room deleted")
        })
    })
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedisClients(pubClient, subClient) {
    const { default: logger, logError } = await import("../utils/logger.js")
    logger.info({ component: "redis" }, "Closing Redis connections")

    try {
        await Promise.all([pubClient.quit(), subClient.quit()])
        logger.info({ component: "redis" }, "Redis connections closed")
    } catch (error) {
        logError(error, { component: "redis" }, "Error closing Redis connections")
        // Force close if graceful close fails
        await Promise.all([pubClient.disconnect(), subClient.disconnect()])
    }
}

/**
 * Test Redis connection
 * 
 * @param {RedisClient} client
 * @returns {Promise<boolean>}
 */
export async function testRedisConnection(client) {
    try {
        await client.ping()
        return true
    } catch (error) {
        console.error("Redis connection test failed:", error)
        return false
    }
}
