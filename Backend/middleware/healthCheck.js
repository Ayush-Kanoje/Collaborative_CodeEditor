/**
 * Health and Readiness Check Middleware
 * 
 * WHY SEPARATE LIVENESS AND READINESS?
 * =====================================
 * 
 * In container orchestration (Kubernetes, ECS, Docker Swarm), these probes serve different purposes:
 * 
 * 1. LIVENESS PROBE (/health):
 *    - Question: "Is the application alive and running?"
 *    - Purpose: Detect if the application is deadlocked, hung, or in an unrecoverable state
 *    - Action on failure: RESTART the container
 *    - Should check: Basic process health, not external dependencies
 *    - Example failures: Memory leak causing OOM, infinite loop, corrupted state
 * 
 * 2. READINESS PROBE (/ready):
 *    - Question: "Is the application ready to serve traffic?"
 *    - Purpose: Determine if the app can handle requests
 *    - Action on failure: REMOVE from load balancer, but DON'T restart
 *    - Should check: External dependencies (DB, Redis, downstream services)
 *    - Example failures: Database connection lost, cache warming incomplete
 * 
 * WHAT BREAKS IF YOU CONFLATE THEM?
 * ==================================
 * 
 * Problem 1: RESTART LOOPS
 * If you check external dependencies in liveness:
 * - Database goes down temporarily
 * - Liveness fails → orchestrator restarts container
 * - New container still can't connect to DB → fails again
 * - Restart loop continues, making outage worse
 * - Correct behavior: Keep container alive, just don't send traffic (readiness)
 * 
 * Problem 2: CASCADING FAILURES
 * If downstream service is slow/down:
 * - Readiness passes → traffic keeps coming
 * - Requests time out → queue builds up
 * - Memory/connections exhausted → complete failure
 * - Correct behavior: Fail readiness early, stop accepting new traffic
 * 
 * Problem 3: STARTUP RACE CONDITIONS
 * Application needs time to warm up (load config, connect to DB, fill cache):
 * - If liveness = readiness → fails during startup
 * - Orchestrator kills container before it finishes starting
 * - Correct behavior: Liveness passes (process is alive), readiness fails (not ready yet)
 * 
 * Problem 4: GRACEFUL DEGRADATION IMPOSSIBLE
 * Service becomes partially degraded (e.g., read-only mode):
 * - If conflated → must report unhealthy → gets restarted
 * - Restart won't fix the issue (it's external)
 * - Correct behavior: Stay alive but report not ready
 * 
 * REAL-WORLD EXAMPLE:
 * ===================
 * Scenario: Your app connects to Redis for session storage
 * 
 * Redis goes down:
 * - /health → 200 OK (process is fine)
 * - /ready → 503 Service Unavailable (can't serve traffic without Redis)
 * - Result: Container stays up, no traffic sent, can recover when Redis returns
 * 
 * If conflated:
 * - /health checks Redis → 503
 * - Orchestrator restarts container
 * - New container still can't reach Redis → restart loop
 * - All containers restart simultaneously → complete outage
 */

import { HEALTH_CHECK_ENABLED } from "../config/env.js"
import logger from "../utils/logger.js"

// Track server readiness state
let isReady = false
let isShuttingDown = false

// Optional Redis client for dependency checks (set by server if available)
export let redisClients = null
export function setRedisClients(clients) {
    redisClients = clients
}

/**
 * Check Redis connectivity
 * @returns {Promise<boolean>}
 */
async function checkRedisConnection() {
    if (!redisClients?.pubClient) {
        return true // Redis is optional
    }

    try {
        const result = await redisClients.pubClient.ping()
        return result === "PONG"
    } catch (error) {
        logger.warn({ error: error.message }, "Redis health check failed")
        return false
    }
}

/**
 * Mark the server as ready to accept traffic
 * Call this after all initialization is complete (DB connections, cache warming, etc.)
 */
export function markReady() {
    isReady = true
    logger.info("Server marked as ready to accept traffic")
}

/**
 * Mark the server as not ready (shutting down or temporarily unable to serve)
 */
export function markNotReady() {
    isReady = false
    logger.info("Server marked as not ready")
}

/**
 * Mark the server as shutting down
 * Readiness will fail, but liveness will still pass
 */
export function markShuttingDown() {
    isShuttingDown = true
    isReady = false
    logger.info("Server marked as shutting down")
}

/**
 * Liveness probe endpoint
 * Simple check: is the process alive and not in a fatal state?
 * Does NOT check external dependencies
 */
export function livenessHandler(req, res) {
    if (!HEALTH_CHECK_ENABLED) {
        return res.status(503).json({
            status: "disabled",
            message: "Health checks are disabled",
        })
    }

    // Basic checks that indicate the process itself is healthy
    const checks = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
    }

    // Check for fatal conditions that warrant a restart
    const memoryUsage = process.memoryUsage()
    const memoryUsagePercent = memoryUsage.heapUsed / memoryUsage.heapTotal

    // If memory is critically high (>95%), process might be in bad state
    const isCriticalMemory = memoryUsagePercent > 0.95

    if (isCriticalMemory) {
        return res.status(503).json({
            status: "unhealthy",
            message: "Critical memory usage detected",
            checks: {
                ...checks,
                memoryUsagePercent: Math.round(memoryUsagePercent * 100),
            },
            timestamp: new Date().toISOString(),
        })
    }

    // Process is alive and healthy
    res.status(200).json({
        status: "healthy",
        message: "Application is alive",
        checks: {
            ...checks,
            memoryUsagePercent: Math.round(memoryUsagePercent * 100),
        },
        timestamp: new Date().toISOString(),
    })
}

/**
 * Readiness probe endpoint
 * Comprehensive check: can the application serve traffic?
 * Checks dependencies and initialization state
 */
export async function readinessHandler(req, res) {
    if (!HEALTH_CHECK_ENABLED) {
        return res.status(503).json({
            status: "disabled",
            message: "Health checks are disabled",
        })
    }

    // If shutting down, not ready for new traffic
    if (isShuttingDown) {
        return res.status(503).json({
            status: "not_ready",
            message: "Server is shutting down",
            ready: false,
            timestamp: new Date().toISOString(),
        })
    }

    // If not marked ready, still initializing
    if (!isReady) {
        return res.status(503).json({
            status: "not_ready",
            message: "Server is still initializing",
            ready: false,
            timestamp: new Date().toISOString(),
        })
    }

    // Perform dependency checks
    const checks = {
        server: true, // Basic server is up
        initialization: isReady,
    }

    // Check optional Redis connection
    if (redisClients?.pubClient) {
        checks.redis = await checkRedisConnection()
    }

    const allChecksPass = Object.values(checks).every((check) => check === true)

    if (!allChecksPass) {
        return res.status(503).json({
            status: "not_ready",
            message: "One or more readiness checks failed",
            ready: false,
            checks,
            timestamp: new Date().toISOString(),
        })
    }

    // All checks passed, ready to serve traffic
    res.status(200).json({
        status: "ready",
        message: "Server is ready to accept traffic",
        ready: true,
        checks,
        timestamp: new Date().toISOString(),
    })
}

/**
 * Legacy health endpoint for backward compatibility
 * Maps to liveness check
 */
export function legacyHealthHandler(req, res) {
    return livenessHandler(req, res)
}
