#!/usr/bin/env node
/**
 * Test script to verify environment-driven configuration
 * Tests that different environment variables actually change behavior
 * 
 * Usage:
 *   node test-env-config.js
 *   PORT=4000 node test-env-config.js
 *   CORS_ORIGIN=https://example.com node test-env-config.js
 */

import { spawn } from "child_process"
import { setTimeout as sleep } from "timers/promises"

const testCases = [
    {
        name: "Default Configuration",
        env: {},
        expectedPort: 3000,
        expectedCorsOrigin: "http://localhost:5173",
    },
    {
        name: "Custom PORT",
        env: { PORT: "4000" },
        expectedPort: 4000,
        expectedCorsOrigin: "http://localhost:5173",
    },
    {
        name: "Custom CORS_ORIGIN",
        env: { CORS_ORIGIN: "https://example.com" },
        expectedPort: 3000,
        expectedCorsOrigin: "https://example.com",
    },
    {
        name: "Production Environment",
        env: {
            NODE_ENV: "production",
            PORT: "8080",
            CORS_ORIGIN: "https://prod.example.com",
        },
        expectedPort: 8080,
        expectedCorsOrigin: "https://prod.example.com",
    },
    {
        name: "Multiple CORS Origins",
        env: {
            CORS_ORIGINS: "http://localhost:3000,http://localhost:5173,https://example.com",
        },
        expectedPort: 3000,
        expectedCorsOrigin: "http://localhost:3000", // First one in the list
    },
]

async function testConfiguration(testCase) {
    console.log(`\n🧪 Testing: ${testCase.name}`)
    console.log(`   Environment: ${JSON.stringify(testCase.env)}`)

    return new Promise((resolve) => {
        const childEnv = { ...process.env, ...testCase.env }
        const child = spawn("node", ["server.js"], {
            env: childEnv,
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
        })

        let output = ""
        let hasStarted = false

        const timeout = setTimeout(() => {
            if (!hasStarted) {
                console.log(`   ❌ FAILED: Server did not start within 5 seconds`)
                child.kill()
                resolve(false)
            }
        }, 5000)

        child.stdout.on("data", (data) => {
            output += data.toString()

            // Check if server has started
            if (output.includes("Server is running on port")) {
                hasStarted = true
                clearTimeout(timeout)

                // Extract actual port from output
                const portMatch = output.match(/Server is running on port (\d+)/)
                const actualPort = portMatch ? parseInt(portMatch[1]) : null

                // Extract actual CORS origin
                const corsMatch = output.match(/CORS Origin: (.+)/)
                const actualCorsOrigin = corsMatch ? corsMatch[1].trim() : null

                // Verify expectations
                const portCorrect = actualPort === testCase.expectedPort
                const corsCorrect = actualCorsOrigin === testCase.expectedCorsOrigin

                if (portCorrect && corsCorrect) {
                    console.log(`   ✅ PASSED`)
                    console.log(`      Port: ${actualPort} (expected: ${testCase.expectedPort})`)
                    console.log(
                        `      CORS: ${actualCorsOrigin} (expected: ${testCase.expectedCorsOrigin})`,
                    )
                } else {
                    console.log(`   ❌ FAILED`)
                    if (!portCorrect) {
                        console.log(
                            `      Port mismatch: got ${actualPort}, expected ${testCase.expectedPort}`,
                        )
                    }
                    if (!corsCorrect) {
                        console.log(
                            `      CORS mismatch: got ${actualCorsOrigin}, expected ${testCase.expectedCorsOrigin}`,
                        )
                    }
                }

                // Test health endpoints
                testHealthEndpoints(actualPort).then(() => {
                    child.kill()
                    resolve(portCorrect && corsCorrect)
                })
            }
        })

        child.stderr.on("data", (data) => {
            console.log(`   ⚠️  stderr: ${data.toString().trim()}`)
        })

        child.on("error", (error) => {
            console.log(`   ❌ FAILED: ${error.message}`)
            clearTimeout(timeout)
            resolve(false)
        })

        child.on("close", (code) => {
            if (!hasStarted) {
                console.log(`   ❌ FAILED: Server exited with code ${code}`)
                clearTimeout(timeout)
                resolve(false)
            }
        })
    })
}

async function testHealthEndpoints(port) {
    console.log(`   🏥 Testing health endpoints on port ${port}...`)

    try {
        // Test liveness endpoint
        const livenessRes = await fetch(`http://localhost:${port}/healthz`)
        const livenessOk = livenessRes.status === 200
        console.log(
            `      ${livenessOk ? "✅" : "❌"} /healthz: ${livenessRes.status} ${livenessRes.statusText}`,
        )

        // Test readiness endpoint
        const readinessRes = await fetch(`http://localhost:${port}/readyz`)
        const readinessOk = readinessRes.status === 200
        console.log(
            `      ${readinessOk ? "✅" : "❌"} /readyz: ${readinessRes.status} ${readinessRes.statusText}`,
        )

        // Test legacy health endpoint
        const legacyRes = await fetch(`http://localhost:${port}/health`)
        const legacyOk = legacyRes.status === 200
        console.log(
            `      ${legacyOk ? "✅" : "❌"} /health: ${legacyRes.status} ${legacyRes.statusText}`,
        )

        if (livenessOk && readinessOk && legacyOk) {
            console.log(`   ✅ All health endpoints working`)
        } else {
            console.log(`   ⚠️  Some health endpoints failed`)
        }
    } catch (error) {
        console.log(`   ❌ Health check failed: ${error.message}`)
    }
}

async function runAllTests() {
    console.log("=" .repeat(60))
    console.log("Environment-Driven Configuration Test Suite")
    console.log("=" .repeat(60))

    let passed = 0
    let failed = 0

    for (const testCase of testCases) {
        const result = await testConfiguration(testCase)
        if (result) {
            passed++
        } else {
            failed++
        }
        // Wait a bit between tests to ensure clean shutdown
        await sleep(1000)
    }

    console.log("\n" + "=".repeat(60))
    console.log(`Test Results: ${passed} passed, ${failed} failed`)
    console.log("=" .repeat(60))

    process.exit(failed > 0 ? 1 : 0)
}

runAllTests().catch((error) => {
    console.error("Test suite failed:", error)
    process.exit(1)
})
