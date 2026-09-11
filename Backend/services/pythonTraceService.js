import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import logger, { logTraceExecution } from "../utils/logger.js"

const MAX_TRACE_BYTES = Number.parseInt(process.env.TRACE_MAX_OUTPUT_BYTES || "1000000", 10)
const TIMEOUT_MS = Number.parseInt(process.env.TRACE_TIMEOUT_MS || "5000", 10)
const MAX_CONCURRENT_TRACES = Number.parseInt(process.env.TRACE_MAX_CONCURRENCY || "4", 10)
const tracerPath = fileURLToPath(new URL("../tracer.py", import.meta.url))
const pythonCommand = process.platform === "win32" ? "python" : "python3"
const activeChildren = new Set()
let activeTraceCount = 0

function failure(code, message) {
    return { success: false, code, message }
}

/** Invokes only the repository's fixed AST interpreter; user code is stdin data. */
export function runPythonTrace(code) {
    const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const startTime = Date.now()

    if (activeTraceCount >= MAX_CONCURRENT_TRACES) {
        logger.warn(
            { activeTraces: activeTraceCount, maxConcurrent: MAX_CONCURRENT_TRACES },
            "Trace service busy",
        )
        return Promise.resolve(failure("TRACE_BUSY", "Trace service is busy; try again shortly."))
    }

    activeTraceCount += 1
    logger.debug({ traceId, activeTraces: activeTraceCount }, "Starting trace execution")

    return new Promise((resolve) => {
        let child
        let stdout = ""
        let settled = false
        let timeout
        const finish = (value) => {
            if (!settled) {
                settled = true
                clearTimeout(timeout)
                activeChildren.delete(child)
                activeTraceCount -= 1

                const duration = Date.now() - startTime
                const success = value.success === true
                const errorCode = success ? null : value.code

                logTraceExecution(traceId, success, duration, errorCode)

                resolve(value)
            }
        }
        try {
            child = spawn(pythonCommand, [tracerPath], {
                stdio: ["pipe", "pipe", "ignore"],
                windowsHide: true,
                env: { ...process.env },
            })
            activeChildren.add(child)
        } catch (err) {
            logger.error({ traceId, error: err.message }, "Failed to spawn trace process")
            finish(failure("TRACE_UNAVAILABLE", "Trace service is unavailable."))
            return
        }
        timeout = setTimeout(() => {
            child.kill()
            logger.warn({ traceId, timeout: TIMEOUT_MS }, "Trace execution timed out")
            finish(failure("TRACE_TIMEOUT", "Trace generation timed out."))
        }, TIMEOUT_MS)
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8")
            if (Buffer.byteLength(stdout, "utf8") > MAX_TRACE_BYTES) {
                child.kill()
                logger.warn(
                    { traceId, outputSize: Buffer.byteLength(stdout, "utf8"), maxSize: MAX_TRACE_BYTES },
                    "Trace output too large",
                )
                finish(failure("TRACE_TOO_LARGE", "Trace output exceeds the allowed size."))
            }
        })
        child.on("error", (err) => {
            logger.error({ traceId, error: err.message }, "Trace process error")
            finish(failure("TRACE_UNAVAILABLE", "Trace service is unavailable."))
        })
        child.on("close", (exitCode) => {
            if (settled) return
            if (exitCode !== 0) {
                logger.warn({ traceId, exitCode }, "Trace generation failed with non-zero exit code")
                return finish(failure("TRACE_FAILED", "Trace generation failed."))
            }
            try {
                const result = JSON.parse(stdout)
                if (!result || typeof result.success !== "boolean") throw new Error("invalid result")
                finish({ success: result.success, result })
            } catch (err) {
                logger.error({ traceId, error: err.message }, "Invalid trace result")
                finish(failure("TRACE_FAILED", "Trace generation returned an invalid result."))
            }
        })
        child.stdin.on("error", (err) => {
            logger.error({ traceId, error: err.message }, "Error writing to trace process stdin")
            child.kill()
            finish(failure("TRACE_UNAVAILABLE", "Trace service is unavailable."))
        })
        child.stdin.end(JSON.stringify({ code, max_steps: 1_000 }))
    })
}

export function shutdownTraceProcesses() {
    logger.info({ activeProcesses: activeChildren.size }, "Shutting down trace processes")
    activeChildren.forEach((child) => child.kill())
}
