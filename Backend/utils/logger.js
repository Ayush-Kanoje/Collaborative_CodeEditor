/**
 * Structured Logger for CloudWatch Integration
 * 
 * WHY STRUCTURED LOGGING?
 * =======================
 * 
 * Traditional logging with console.log:
 * ```
 * console.log('User alice connected to room code-123')
 * console.log('Error saving document: S3 timeout')
 * ```
 * 
 * Output:
 * ```
 * User alice connected to room code-123
 * Error saving document: S3 timeout
 * ```
 * 
 * Problems:
 * - Can't query by user, room, or error type
 * - Can't filter by severity (info vs error)
 * - Can't aggregate metrics (how many S3 timeouts?)
 * - Difficult to parse and analyze
 * - No context (timestamp, server, environment)
 * 
 * Structured logging with JSON:
 * ```
 * logger.info({ user: 'alice', room: 'code-123' }, 'User connected')
 * logger.error({ service: 's3', operation: 'save' }, 'Save failed: timeout')
 * ```
 * 
 * Output:
 * ```json
 * {"level":"info","time":1234567890,"user":"alice","room":"code-123","msg":"User connected"}
 * {"level":"error","time":1234567891,"service":"s3","operation":"save","msg":"Save failed: timeout"}
 * ```
 * 
 * Benefits:
 * - ✅ Query by any field: `user="alice"`, `room="code-123"`, `service="s3"`
 * - ✅ Filter by severity: `level="error"`
 * - ✅ Aggregate metrics: COUNT(service="s3" AND msg LIKE "timeout")
 * - ✅ Automatic context (timestamp, hostname, pid)
 * - ✅ CloudWatch Insights can parse and visualize
 * 
 * CLOUDWATCH INTEGRATION:
 * =======================
 * 
 * CloudWatch Insights Queries:
 * ```
 * # Find all errors in last hour
 * fields @timestamp, level, msg, error
 * | filter level = "error"
 * | sort @timestamp desc
 * 
 * # Count errors by service
 * fields service, count(*) as error_count
 * | filter level = "error"
 * | stats count() by service
 * 
 * # Find slow operations
 * fields @timestamp, operation, duration
 * | filter duration > 1000
 * | sort duration desc
 * 
 * # Track user activity
 * fields @timestamp, user, action, room
 * | filter user = "alice"
 * | sort @timestamp desc
 * ```
 * 
 * PINO FEATURES:
 * ==============
 * 
 * 1. Extreme Performance (faster than Winston, Bunyan)
 *    - 5x faster than Winston
 *    - Minimal CPU overhead
 *    - Async logging (non-blocking)
 * 
 * 2. Automatic Fields:
 *    - timestamp (ISO 8601)
 *    - hostname
 *    - pid (process ID)
 *    - level (30=info, 40=warn, 50=error)
 * 
 * 3. Child Loggers (contextual logging):
 *    ```javascript
 *    const requestLogger = logger.child({ requestId: '123' })
 *    requestLogger.info('Processing request')
 *    // Outputs: {"level":"info","requestId":"123","msg":"Processing request"}
 *    ```
 * 
 * 4. Redaction (hide sensitive data):
 *    ```javascript
 *    logger.info({ password: 'secret123' }, 'User login')
 *    // Outputs: {"password":"[Redacted]",...}
 *    ```
 */

import pino from "pino"
import { LOG_LEVEL, IS_PRODUCTION, IS_DEVELOPMENT } from "../config/env.js"

// Redact sensitive fields from logs
const redactPaths = [
    "password",
    "token",
    "apiKey",
    "secret",
    "authorization",
    "cookie",
    "*.password",
    "*.token",
    "req.headers.authorization",
    "req.headers.cookie",
]

// Configure Pino logger
const logger = pino({
    // Log level from environment
    level: LOG_LEVEL,

    // Base fields (always included)
    base: {
        env: process.env.NODE_ENV || "development",
        service: "collaborative-editor",
    },

    // Redact sensitive fields
    redact: {
        paths: redactPaths,
        censor: "[REDACTED]",
    },

    // Timestamp format
    timestamp: pino.stdTimeFunctions.isoTime,

    // Formatting for development (pretty print)
    // In production: use JSON for CloudWatch
    ...(IS_DEVELOPMENT && {
        transport: {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "HH:MM:ss.l",
                ignore: "pid,hostname",
                singleLine: false,
            },
        },
    }),

    // Error serialization (includes stack traces)
    serializers: {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
    },
})

/**
 * Create child logger with request context
 * 
 * @param {object} context - Additional context fields
 * @returns {Logger}
 */
export function createChildLogger(context) {
    return logger.child(context)
}

/**
 * Log HTTP request
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {number} duration - Request duration in ms
 */
export function logRequest(req, res, duration) {
    logger.info(
        {
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration,
            userAgent: req.headers["user-agent"],
            ip: req.ip,
        },
        "HTTP request",
    )
}

/**
 * Log error with context
 * 
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 * @param {string} message - Error message
 */
export function logError(error, context = {}, message = "Error occurred") {
    logger.error(
        {
            error: {
                message: error.message,
                stack: error.stack,
                code: error.code,
                name: error.name,
            },
            ...context,
        },
        message,
    )
}

/**
 * Log document operation (save/load)
 * 
 * @param {string} operation - Operation type (save/load)
 * @param {string} roomName - Room identifier
 * @param {string} backend - Storage backend (s3/dynamodb)
 * @param {number} size - Document size in bytes
 * @param {number} duration - Operation duration in ms
 */
export function logDocumentOperation(operation, roomName, backend, size, duration) {
    logger.info(
        {
            operation,
            roomName,
            backend,
            size,
            duration,
            category: "document",
        },
        `Document ${operation} completed`,
    )
}

/**
 * Log Socket.IO connection event
 * 
 * @param {string} event - Event type (connect/disconnect)
 * @param {string} userId - User identifier
 * @param {string} room - Room name
 * @param {object} metadata - Additional metadata
 */
export function logSocketEvent(event, userId, room, metadata = {}) {
    logger.info(
        {
            event,
            userId,
            room,
            category: "socket",
            ...metadata,
        },
        `Socket ${event}`,
    )
}

/**
 * Log Redis operation
 * 
 * @param {string} operation - Operation type
 * @param {boolean} success - Whether operation succeeded
 * @param {number} duration - Operation duration in ms
 */
export function logRedisOperation(operation, success, duration) {
    const logData = {
        operation,
        success,
        duration,
        category: "redis",
    }
    const message = `Redis ${operation} ${success ? "succeeded" : "failed"}`
    
    if (success) {
        logger.info(logData, message)
    } else {
        logger.error(logData, message)
    }
}

/**
 * Log trace execution
 * 
 * @param {string} traceId - Trace identifier
 * @param {boolean} success - Whether trace succeeded
 * @param {number} duration - Execution duration in ms
 * @param {string} errorCode - Error code if failed
 */
export function logTraceExecution(traceId, success, duration, errorCode = null) {
    const logData = {
        traceId,
        success,
        duration,
        errorCode,
        category: "trace",
    }
    const message = `Python trace ${success ? "completed" : "failed"}`
    
    if (success) {
        logger.info(logData, message)
    } else {
        logger.warn(logData, message)
    }
}

// Export default logger
export default logger
