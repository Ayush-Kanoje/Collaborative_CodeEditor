#!/usr/bin/env node
/**
 * CORS Allowlist Test Suite
 * 
 * Tests that CORS configuration properly rejects unauthorized origins
 * and only allows explicitly configured origins.
 * 
 * Usage:
 *   # Start server with specific CORS config
 *   CORS_ORIGIN=https://example.com npm start
 *   
 *   # In another terminal, run tests
 *   node test-cors.js http://localhost:3000 https://example.com
 */

const COLORS = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
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

function warn(message) {
    log(COLORS.yellow, "⚠", message)
}

async function testCorsRequest(serverUrl, origin, shouldAllow) {
    try {
        const response = await fetch(serverUrl + "/health", {
            method: "GET",
            headers: {
                Origin: origin,
            },
        })

        const allowOriginHeader = response.headers.get("access-control-allow-origin")
        const status = response.status

        // Check if request was allowed
        const wasAllowed = status !== 403 && allowOriginHeader === origin

        if (shouldAllow && wasAllowed) {
            pass(
                `Origin "${origin}" was correctly ALLOWED (${status}, CORS header: ${allowOriginHeader})`,
            )
            return true
        } else if (!shouldAllow && !wasAllowed) {
            pass(
                `Origin "${origin}" was correctly REJECTED (${status}, CORS header: ${allowOriginHeader || "none"})`,
            )
            return true
        } else if (shouldAllow && !wasAllowed) {
            fail(
                `Origin "${origin}" should be ALLOWED but was REJECTED (${status}, CORS header: ${allowOriginHeader || "none"})`,
            )
            return false
        } else {
            fail(
                `Origin "${origin}" should be REJECTED but was ALLOWED (${status}, CORS header: ${allowOriginHeader})`,
            )
            return false
        }
    } catch (error) {
        fail(`Request failed for origin "${origin}": ${error.message}`)
        return false
    }
}

async function testPreflightRequest(serverUrl, origin, shouldAllow) {
    try {
        const response = await fetch(serverUrl + "/api/trace", {
            method: "OPTIONS",
            headers: {
                Origin: origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        })

        const allowOriginHeader = response.headers.get("access-control-allow-origin")
        const status = response.status

        // Preflight should return 204 or 200 if allowed, 403 if rejected
        const wasAllowed = (status === 204 || status === 200) && allowOriginHeader === origin

        if (shouldAllow && wasAllowed) {
            pass(
                `Preflight for "${origin}" was correctly ALLOWED (${status}, CORS header: ${allowOriginHeader})`,
            )
            return true
        } else if (!shouldAllow && !wasAllowed) {
            pass(
                `Preflight for "${origin}" was correctly REJECTED (${status}, CORS header: ${allowOriginHeader || "none"})`,
            )
            return true
        } else if (shouldAllow && !wasAllowed) {
            fail(
                `Preflight for "${origin}" should be ALLOWED but was REJECTED (${status}, CORS header: ${allowOriginHeader || "none"})`,
            )
            return false
        } else {
            fail(
                `Preflight for "${origin}" should be REJECTED but was ALLOWED (${status}, CORS header: ${allowOriginHeader})`,
            )
            return false
        }
    } catch (error) {
        fail(`Preflight request failed for origin "${origin}": ${error.message}`)
        return false
    }
}

async function runTests() {
    const args = process.argv.slice(2)

    if (args.length < 2) {
        console.log("Usage: node test-cors.js <server-url> <allowed-origin> [allowed-origin2...]")
        console.log("")
        console.log("Example:")
        console.log("  node test-cors.js http://localhost:3000 https://example.com")
        console.log("")
        console.log("First start your server with CORS config:")
        console.log("  CORS_ORIGIN=https://example.com npm start")
        process.exit(1)
    }

    const serverUrl = args[0]
    const allowedOrigins = args.slice(1)

    console.log("=".repeat(70))
    console.log("CORS Allowlist Test Suite")
    console.log("=".repeat(70))
    console.log("")
    info(`Server URL: ${serverUrl}`)
    info(`Allowed Origins: ${allowedOrigins.join(", ")}`)
    console.log("")

    // Test origins
    const testOrigins = [
        // Allowed origins from args
        ...allowedOrigins.map((origin) => ({ origin, shouldAllow: true })),

        // Origins that should be rejected
        { origin: "https://evil.com", shouldAllow: false },
        { origin: "https://attacker.net", shouldAllow: false },
        { origin: "http://malicious.org", shouldAllow: false },
        { origin: "https://example.com.evil.com", shouldAllow: false }, // Subdomain confusion
        { origin: "https://not-example.com", shouldAllow: false },
        { origin: "null", shouldAllow: false }, // Null origin
    ]

    // Deduplicate test origins
    const uniqueTestOrigins = testOrigins.filter(
        (test, index, self) =>
            index === self.findIndex((t) => t.origin === test.origin),
    )

    let passed = 0
    let failed = 0

    // Test 1: Simple requests
    console.log("─".repeat(70))
    console.log("Test 1: Simple CORS Requests")
    console.log("─".repeat(70))
    for (const test of uniqueTestOrigins) {
        const result = await testCorsRequest(serverUrl, test.origin, test.shouldAllow)
        if (result) passed++
        else failed++
    }

    // Test 2: Preflight requests
    console.log("")
    console.log("─".repeat(70))
    console.log("Test 2: CORS Preflight Requests (OPTIONS)")
    console.log("─".repeat(70))
    for (const test of uniqueTestOrigins) {
        const result = await testPreflightRequest(serverUrl, test.origin, test.shouldAllow)
        if (result) passed++
        else failed++
    }

    // Test 3: No Origin header (should be allowed - non-CORS requests)
    console.log("")
    console.log("─".repeat(70))
    console.log("Test 3: Requests Without Origin Header")
    console.log("─".repeat(70))
    try {
        const response = await fetch(serverUrl + "/health")
        const status = response.status
        if (status === 200) {
            pass(`Request without Origin header was allowed (${status})`)
            passed++
        } else {
            fail(`Request without Origin header was rejected (${status})`)
            failed++
        }
    } catch (error) {
        fail(`Request without Origin header failed: ${error.message}`)
        failed++
    }

    // Test 4: Actual API request (POST with JSON)
    console.log("")
    console.log("─".repeat(70))
    console.log("Test 4: Real API Requests")
    console.log("─".repeat(70))

    for (const allowedOrigin of allowedOrigins) {
        try {
            const response = await fetch(serverUrl + "/api/trace", {
                method: "POST",
                headers: {
                    Origin: allowedOrigin,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    language: "python",
                    code: "x = 1\nprint(x)",
                }),
            })

            const corsHeader = response.headers.get("access-control-allow-origin")
            const status = response.status

            if (corsHeader === allowedOrigin && (status === 200 || status === 422)) {
                pass(
                    `API request from "${allowedOrigin}" succeeded (${status}, CORS: ${corsHeader})`,
                )
                passed++
            } else {
                fail(
                    `API request from "${allowedOrigin}" failed (${status}, CORS: ${corsHeader || "none"})`,
                )
                failed++
            }
        } catch (error) {
            fail(`API request from "${allowedOrigin}" failed: ${error.message}`)
            failed++
        }
    }

    // Test rejected origin
    try {
        const response = await fetch(serverUrl + "/api/trace", {
            method: "POST",
            headers: {
                Origin: "https://evil.com",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                language: "python",
                code: "x = 1",
            }),
        })

        const status = response.status
        if (status === 403) {
            pass(`API request from "https://evil.com" was correctly rejected (${status})`)
            passed++
        } else {
            fail(
                `API request from "https://evil.com" should be rejected but got ${status}`,
            )
            failed++
        }
    } catch (error) {
        fail(`API request from "https://evil.com" failed: ${error.message}`)
        failed++
    }

    // Summary
    console.log("")
    console.log("=".repeat(70))
    console.log("Test Summary")
    console.log("=".repeat(70))
    console.log(`Total tests: ${passed + failed}`)
    log(COLORS.green, "✓", `Passed: ${passed}`)
    log(COLORS.red, "✗", `Failed: ${failed}`)
    console.log("=".repeat(70))

    if (failed === 0) {
        console.log("")
        log(COLORS.green, "🎉", "All CORS tests passed! Your allowlist is working correctly.")
        process.exit(0)
    } else {
        console.log("")
        log(COLORS.red, "❌", "Some CORS tests failed. Check your configuration.")
        process.exit(1)
    }
}

runTests().catch((error) => {
    console.error("Test suite failed:", error)
    process.exit(1)
})
