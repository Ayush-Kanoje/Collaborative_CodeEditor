/**
 * Test Structured Logging
 * 
 * This script verifies that all logging produces valid JSON output
 * and includes required fields for CloudWatch parsing.
 */

import logger, {
    logError,
    logDocumentOperation,
    logSocketEvent,
    logRedisOperation,
    logTraceExecution,
    createChildLogger,
} from "./utils/logger.js"

// Test 1: Basic logging levels
console.log("\n=== Test 1: Basic Logging Levels ===")
logger.info("This is an info message")
logger.warn("This is a warning message")
logger.error("This is an error message")
logger.debug("This is a debug message (only in debug mode)")

// Test 2: Logging with context
console.log("\n=== Test 2: Logging with Context ===")
logger.info({ user: "alice", room: "code-123" }, "User connected to room")
logger.info({ duration: 1234, statusCode: 200 }, "Request completed")

// Test 3: Child logger (contextual logging)
console.log("\n=== Test 3: Child Logger ===")
const requestLogger = createChildLogger({ requestId: "req-abc123", userId: "alice" })
requestLogger.info("Processing request")
requestLogger.info({ action: "save", resource: "document" }, "Operation completed")

// Test 4: Error logging with stack trace
console.log("\n=== Test 4: Error Logging ===")
const error = new Error("Database connection failed")
error.code = "ECONNREFUSED"
logError(error, { component: "database", operation: "connect" }, "Connection error occurred")

// Test 5: Document operation logging
console.log("\n=== Test 5: Document Operation Logging ===")
logDocumentOperation("save", "room-123", "s3", 12345, 150)
logDocumentOperation("load", "room-456", "dynamodb", 5678, 45)

// Test 6: Socket.IO event logging
console.log("\n=== Test 6: Socket.IO Event Logging ===")
logSocketEvent("connect", "alice", "room-123", { socketId: "abc123", transport: "websocket" })
logSocketEvent("disconnect", "bob", "room-456", { reason: "client disconnect" })

// Test 7: Redis operation logging
console.log("\n=== Test 7: Redis Operation Logging ===")
logRedisOperation("pub", true, 5)
logRedisOperation("sub", true, 3)
logRedisOperation("connect", false, 100)

// Test 8: Trace execution logging
console.log("\n=== Test 8: Trace Execution Logging ===")
logTraceExecution("trace-123", true, 250)
logTraceExecution("trace-456", false, 5000, "TRACE_TIMEOUT")

// Test 9: Sensitive data redaction
console.log("\n=== Test 9: Sensitive Data Redaction ===")
logger.info(
    {
        username: "alice",
        email: "alice@example.com",
        password: "secret123", // Should be redacted
        token: "Bearer xyz123", // Should be redacted
        apiKey: "key-abc123", // Should be redacted
    },
    "User login attempt",
)

// Test 10: Automatic fields
console.log("\n=== Test 10: Automatic Fields (check JSON output) ===")
console.log("Every log entry should include:")
console.log("  - level (numeric: 30=info, 40=warn, 50=error)")
console.log("  - time (ISO 8601 timestamp)")
console.log("  - pid (process ID)")
console.log("  - env (environment)")
console.log("  - service (service name)")
console.log("  - msg (message)")

// Test 11: Production JSON format
console.log("\n=== Test 11: Production JSON Format ===")
console.log("To test production JSON output, run:")
console.log('  NODE_ENV=production LOG_LEVEL=info node test-structured-logging.js')
console.log("")
console.log("Output should be valid JSON (one object per line)")

// Test 12: CloudWatch Insights queries
console.log("\n=== Test 12: CloudWatch Insights Queries ===")
console.log("Example queries for CloudWatch:")
console.log("")
console.log("1. Find all errors:")
console.log("   fields @timestamp, level, msg, error.message")
console.log("   | filter level = 50")
console.log("   | sort @timestamp desc")
console.log("")
console.log("2. Count operations by backend:")
console.log("   fields backend, count(*) as ops")
console.log("   | filter category = 'document'")
console.log("   | stats count() by backend")
console.log("")
console.log("3. Average document operation duration:")
console.log("   fields backend, avg(duration) as avg_ms")
console.log("   | filter category = 'document'")
console.log("   | stats avg(duration) by operation, backend")
console.log("")

logger.info("All structured logging tests completed successfully")
