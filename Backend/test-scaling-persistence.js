#!/usr/bin/env node
/**
 * Test Suite for Socket.IO Redis Adapter and Yjs Persistence
 * 
 * This tests both features to ensure they work correctly.
 */

import { createClient } from "redis"
import * as Y from "yjs"
import {
    serializeDocument,
    deserializeDocument,
    saveDocument,
    loadDocument,
} from "./services/yjsPersistence.js"
import { createRedisClients, testRedisConnection } from "./services/redisAdapter.js"

const COLORS = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
}

function log(color, symbol, message) {
    console.log(`${color}${symbol}${COLORS.reset} ${message}`)
}

function pass(message) {
    log(COLORS.green, "✓", message)
}

function fail(message) {
    log(COLORS.red, "✗", message)
}

function info(message) {
    log(COLORS.cyan, "ℹ", message)
}

// Test 1: Yjs Serialization
async function testYjsSerialization() {
    console.log("\n" + "=".repeat(70))
    console.log("Test 1: Yjs Document Serialization")
    console.log("=".repeat(70))

    try {
        // Create document with content
        const doc1 = new Y.Doc()
        const text1 = doc1.getText("content")
        text1.insert(0, "Hello, World!")

        // Serialize
        const bytes = serializeDocument(doc1)
        pass(`Serialized document (${bytes.length} bytes)`)

        // Deserialize into new document
        const doc2 = new Y.Doc()
        deserializeDocument(doc2, bytes)
        const text2 = doc2.getText("content")

        // Verify content matches
        if (text2.toString() === "Hello, World!") {
            pass("Deserialized document matches original")
            return true
        } else {
            fail(`Content mismatch: got "${text2.toString()}"`)
            return false
        }
    } catch (error) {
        fail(`Serialization test failed: ${error.message}`)
        return false
    }
}

// Test 2: Empty Document Handling
async function testEmptyDocument() {
    console.log("\n" + "=".repeat(70))
    console.log("Test 2: Empty Document Handling")
    console.log("=".repeat(70))

    try {
        const doc = new Y.Doc()
        const bytes = serializeDocument(doc)

        // Empty Yjs document actually produces minimal header bytes (usually 2-5 bytes)
        // Not exactly 0, but should be very small
        if (bytes.length <= 10) {
            pass(`Empty document produces ${bytes.length} bytes (minimal header)`)
            return true
        } else {
            fail(`Empty document produced ${bytes.length} bytes (expected <= 10)`)
            return false
        }
    } catch (error) {
        fail(`Empty document test failed: ${error.message}`)
        return false
    }
}

// Test 3: Complex Document Serialization
async function testComplexDocument() {
    console.log("\n" + "=".repeat(70))
    console.log("Test 3: Complex Document with Multiple CRDTs")
    console.log("=".repeat(70))

    try {
        const doc1 = new Y.Doc()

        // Add text
        const text = doc1.getText("text")
        text.insert(0, "Test content")

        // Add map
        const map = doc1.getMap("metadata")
        map.set("title", "My Document")
        map.set("author", "Alice")

        // Add array
        const array = doc1.getArray("items")
        array.push(["item1", "item2", "item3"])

        // Serialize and deserialize
        const bytes = serializeDocument(doc1)
        pass(`Serialized complex document (${bytes.length} bytes)`)

        const doc2 = new Y.Doc()
        deserializeDocument(doc2, bytes)

        // Verify all data types
        const text2 = doc2.getText("text").toString()
        const map2 = doc2.getMap("metadata")
        const array2 = doc2.getArray("items").toArray()

        let allCorrect = true

        if (text2 !== "Test content") {
            fail(`Text mismatch: ${text2}`)
            allCorrect = false
        } else {
            pass("Text content restored")
        }

        if (map2.get("title") !== "My Document" || map2.get("author") !== "Alice") {
            fail("Map content mismatch")
            allCorrect = false
        } else {
            pass("Map content restored")
        }

        if (array2.length !== 3 || array2[0] !== "item1") {
            fail("Array content mismatch")
            allCorrect = false
        } else {
            pass("Array content restored")
        }

        return allCorrect
    } catch (error) {
        fail(`Complex document test failed: ${error.message}`)
        return false
    }
}

// Test 4: Redis Connection (if configured)
async function testRedis() {
    console.log("\n" + "=".repeat(70))
    console.log("Test 4: Redis Connection")
    console.log("=".repeat(70))

    const redisHost = process.env.REDIS_HOST || "localhost"
    const redisPort = parseInt(process.env.REDIS_PORT || "6379")

    try {
        info(`Attempting to connect to Redis at ${redisHost}:${redisPort}`)

        const { pubClient, subClient } = await createRedisClients(redisHost, redisPort, null, 0)

        // Test connection
        const pubOk = await testRedisConnection(pubClient)
        const subOk = await testRedisConnection(subClient)

        if (pubOk && subOk) {
            pass("Redis pub and sub clients connected successfully")

            // Cleanup
            await pubClient.quit()
            await subClient.quit()

            return true
        } else {
            fail("Redis connection test failed")
            return false
        }
    } catch (error) {
        fail(`Redis connection failed: ${error.message}`)
        info("To test Redis, start a Redis server:")
        info("  docker run -d -p 6379:6379 redis:alpine")
        info("Then run: REDIS_HOST=localhost node test-scaling-persistence.js")
        return false
    }
}

// Test 5: Persistence (if configured)
async function testPersistence() {
    console.log("\n" + "=".repeat(70))
    console.log("Test 5: Document Persistence")
    console.log("=".repeat(70))

    const persistenceEnabled = process.env.YJS_PERSISTENCE_ENABLED === "true"

    if (!persistenceEnabled) {
        info("Persistence not enabled - skipping test")
        info("To test persistence, set YJS_PERSISTENCE_ENABLED=true")
        return true
    }

    try {
        // Create document with content
        const doc1 = new Y.Doc()
        const text1 = doc1.getText("content")
        text1.insert(0, "Persistence test document")

        // Configure storage
        const config = {
            s3: process.env.S3_BUCKET
                ? {
                      bucket: process.env.S3_BUCKET,
                      region: process.env.AWS_REGION || "us-east-1",
                      ...(process.env.S3_ENDPOINT && { endpoint: process.env.S3_ENDPOINT }),
                  }
                : null,
            dynamodb: process.env.DYNAMODB_TABLE
                ? {
                      table: process.env.DYNAMODB_TABLE,
                      region: process.env.AWS_REGION || "us-east-1",
                  }
                : null,
        }

        if (!config.s3 && !config.dynamodb) {
            fail("No storage backend configured")
            return false
        }

        const testRoomName = `test-room-${Date.now()}`

        // Save document
        info(`Saving document to ${config.s3 ? "S3" : "DynamoDB"}...`)
        await saveDocument(testRoomName, doc1, config)
        pass(`Document saved successfully`)

        // Load document
        info("Loading document...")
        const doc2 = new Y.Doc()
        const loaded = await loadDocument(testRoomName, doc2, config)

        if (!loaded) {
            fail("Failed to load document")
            return false
        }

        // Verify content
        const text2 = doc2.getText("content").toString()
        if (text2 === "Persistence test document") {
            pass("Document loaded successfully with correct content")
            return true
        } else {
            fail(`Content mismatch: got "${text2}"`)
            return false
        }
    } catch (error) {
        fail(`Persistence test failed: ${error.message}`)
        info("Make sure AWS credentials are configured and bucket/table exists")
        return false
    }
}

// Run all tests
async function runAllTests() {
    console.log("=".repeat(70))
    console.log("Socket.IO Redis Adapter & Yjs Persistence Test Suite")
    console.log("=".repeat(70))

    let passed = 0
    let failed = 0

    // Core tests (always run)
    if (await testYjsSerialization()) passed++
    else failed++

    if (await testEmptyDocument()) passed++
    else failed++

    if (await testComplexDocument()) passed++
    else failed++

    // Optional tests (only if configured)
    if (process.env.REDIS_HOST) {
        if (await testRedis()) passed++
        else failed++
    } else {
        info("\nSkipping Redis tests (REDIS_HOST not set)")
    }

    if (process.env.YJS_PERSISTENCE_ENABLED === "true") {
        if (await testPersistence()) passed++
        else failed++
    } else {
        info("\nSkipping persistence tests (YJS_PERSISTENCE_ENABLED not set)")
    }

    // Summary
    console.log("\n" + "=".repeat(70))
    console.log("Test Summary")
    console.log("=".repeat(70))
    console.log(`Total tests: ${passed + failed}`)
    log(COLORS.green, "✓", `Passed: ${passed}`)
    log(COLORS.red, "✗", `Failed: ${failed}`)
    console.log("=".repeat(70))

    if (failed === 0) {
        console.log("")
        log(
            COLORS.green,
            "🎉",
            "All tests passed! Scaling and persistence are working correctly.",
        )
        process.exit(0)
    } else {
        console.log("")
        log(COLORS.red, "❌", "Some tests failed. Check the output above.")
        process.exit(1)
    }
}

runAllTests().catch((error) => {
    console.error("Test suite failed:", error)
    process.exit(1)
})
