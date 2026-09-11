/**
 * Environment-driven configuration
 * All configuration values come from environment variables with sensible defaults
 */

/**
 * Parse a positive integer from environment variable
 * @param {string} value - Environment variable value
 * @param {number} defaultValue - Default value if parsing fails
 * @returns {number}
 */
function parsePositiveInt(value, defaultValue) {
    const parsed = Number.parseInt(value, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue
}

/**
 * Parse boolean from environment variable
 * @param {string} value - Environment variable value
 * @param {boolean} defaultValue - Default value
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null) return defaultValue
    const normalized = value.toLowerCase().trim()
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true
    if (normalized === "false" || normalized === "0" || normalized === "no") return false
    return defaultValue
}

/**
 * Parse comma-separated list from environment variable
 * @param {string} value - Environment variable value
 * @param {string[]} defaultValue - Default array
 * @returns {string[]}
 */
function parseArray(value, defaultValue) {
    if (!value) return defaultValue
    return value.split(",").map((item) => item.trim()).filter(Boolean)
}

// Server Configuration
export const PORT = parsePositiveInt(process.env.PORT, 3000)
export const NODE_ENV = process.env.NODE_ENV || "development"
export const IS_PRODUCTION = NODE_ENV === "production"
export const IS_DEVELOPMENT = NODE_ENV === "development"

// CORS Configuration
export const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173"
export const CORS_ORIGINS = parseArray(process.env.CORS_ORIGINS, [CORS_ORIGIN])
export const CORS_METHODS = parseArray(process.env.CORS_METHODS, ["GET", "POST", "OPTIONS"])
export const CORS_ALLOW_HEADERS = parseArray(
    process.env.CORS_ALLOW_HEADERS,
    ["Content-Type", "Authorization"],
)

// Presence/Collaboration Configuration
export const PRESENCE_REMOVAL_GRACE_MS = parsePositiveInt(
    process.env.PRESENCE_REMOVAL_GRACE_MS,
    20_000,
)

// Python Trace Service Configuration
export const TRACE_MAX_OUTPUT_BYTES = parsePositiveInt(
    process.env.TRACE_MAX_OUTPUT_BYTES,
    1_000_000,
)
export const TRACE_TIMEOUT_MS = parsePositiveInt(process.env.TRACE_TIMEOUT_MS, 5_000)
export const TRACE_MAX_CONCURRENCY = parsePositiveInt(process.env.TRACE_MAX_CONCURRENCY, 4)
export const TRACE_CPU_SECONDS = parsePositiveInt(process.env.TRACE_CPU_SECONDS, 2)

// Graceful Shutdown Configuration
export const SHUTDOWN_TIMEOUT_MS = parsePositiveInt(process.env.SHUTDOWN_TIMEOUT_MS, 10_000)

// Health Check Configuration
export const HEALTH_CHECK_ENABLED = parseBoolean(process.env.HEALTH_CHECK_ENABLED, true)

// Logging Configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? "info" : "debug")
export const LOG_REQUESTS = parseBoolean(process.env.LOG_REQUESTS, IS_DEVELOPMENT)

// Redis Configuration (for Socket.IO adapter - enables horizontal scaling)
export const REDIS_HOST = process.env.REDIS_HOST || null
export const REDIS_PORT = parsePositiveInt(process.env.REDIS_PORT, 6379)
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null
export const REDIS_DB = parsePositiveInt(process.env.REDIS_DB, 0)

// Yjs Persistence Configuration
export const YJS_PERSISTENCE_ENABLED = parseBoolean(process.env.YJS_PERSISTENCE_ENABLED, false)
export const YJS_STORAGE_BACKEND = process.env.YJS_STORAGE_BACKEND || "s3" // "s3" or "dynamodb"

// S3 Configuration
export const AWS_REGION = process.env.AWS_REGION || "us-east-1"
export const S3_BUCKET = process.env.S3_BUCKET || null
export const S3_ENDPOINT = process.env.S3_ENDPOINT || null // For LocalStack/MinIO

// DynamoDB Configuration
export const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "yjs-documents"
export const DYNAMODB_TTL_DAYS = parsePositiveInt(process.env.DYNAMODB_TTL_DAYS, 30)

/**
 * Validate required environment variables
 * Throws an error if critical configuration is missing or invalid
 */
export function validateConfig() {
    const errors = []

    if (PORT < 1 || PORT > 65535) {
        errors.push(`PORT must be between 1 and 65535, got: ${PORT}`)
    }

    if (!CORS_ORIGIN) {
        errors.push("CORS_ORIGIN is required")
    }

    if (TRACE_TIMEOUT_MS < 1000) {
        errors.push("TRACE_TIMEOUT_MS should be at least 1000ms")
    }

    if (TRACE_MAX_CONCURRENCY < 1) {
        errors.push("TRACE_MAX_CONCURRENCY must be at least 1")
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join("\n")}`)
    }
}

/**
 * Print current configuration (safe for logging)
 */
export function printConfig() {
    console.log("=== Application Configuration ===")
    console.log(`Environment: ${NODE_ENV}`)
    console.log(`Port: ${PORT}`)
    console.log(`CORS Origin: ${CORS_ORIGIN}`)
    console.log(`CORS Origins: ${CORS_ORIGINS.join(", ")}`)
    console.log(`Log Level: ${LOG_LEVEL}`)
    console.log(`Trace Max Concurrency: ${TRACE_MAX_CONCURRENCY}`)
    console.log(`Trace Timeout: ${TRACE_TIMEOUT_MS}ms`)
    console.log(`Presence Grace Period: ${PRESENCE_REMOVAL_GRACE_MS}ms`)
    if (REDIS_HOST) {
        console.log(`Redis: ${REDIS_HOST}:${REDIS_PORT}`)
    }
    if (YJS_PERSISTENCE_ENABLED) {
        console.log(`Yjs Persistence: ${YJS_STORAGE_BACKEND}`)
    }
    console.log("================================")
}
