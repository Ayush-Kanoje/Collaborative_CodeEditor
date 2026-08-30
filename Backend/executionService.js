import Docker from "dockerode";
import { randomUUID } from "crypto";

const EXECUTION_TIMEOUT_MS = 5000;
const MEMORY_LIMIT = "128m";
const CPU_QUOTA = 50000;
const CPU_PERIOD = 100000;
const PIDS_LIMIT = 64;
const OUTPUT_SIZE_LIMIT = 1024 * 1024;
const MAX_CODE_SIZE = 100 * 1024;

const LANGUAGE_CONFIGS = {
  python: {
    image: "python:3.11-alpine",
    command: ["python3", "/tmp/code.py"],
    fileExtension: ".py",
    prepareCode: (code) => code,
  },
};

const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = rateLimitStore.get(userId) || [];
  const recentRequests = userRequests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestRequest = recentRequests[0];
    const resetTime = oldestRequest + RATE_LIMIT_WINDOW_MS;
    return { allowed: false, resetTime, remaining: 0 };
  }
  
  recentRequests.push(now);
  rateLimitStore.set(userId, recentRequests);
  return { allowed: true, resetTime: now + RATE_LIMIT_WINDOW_MS, remaining: RATE_LIMIT_MAX_REQUESTS - recentRequests.length };
}

function validateLanguage(language) {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_CONFIGS, language);
}

function validateCode(code) {
  if (typeof code !== "string") return { valid: false, error: "Code must be a string" };
  if (code.length === 0) return { valid: false, error: "Code cannot be empty" };
  if (code.length > MAX_CODE_SIZE) return { valid: false, error: `Code exceeds maximum size of ${MAX_CODE_SIZE} bytes` };
  return { valid: true };
}

function sanitizeOutput(output, limit = OUTPUT_SIZE_LIMIT) {
  if (!output) return "";
  if (output.length > limit) return output.slice(0, limit) + "\n[Output truncated: exceeded size limit]";
  return output;
}

export async function executeCode({ code, language, userId }) {
  const executionId = randomUUID();
  const startTime = Date.now();
  
  if (!validateLanguage(language)) {
    return { executionId, status: "failed", error: `Unsupported language: ${language}. Supported: ${Object.keys(LANGUAGE_CONFIGS).join(", ")}`, stdout: "", stderr: "", exitCode: -1, durationMs: Date.now() - startTime };
  }
  
  const codeValidation = validateCode(code);
  if (!codeValidation.valid) {
    return { executionId, status: "failed", error: codeValidation.error, stdout: "", stderr: "", exitCode: -1, durationMs: Date.now() - startTime };
  }
  
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return { executionId, status: "failed", error: `Rate limit exceeded. Try again after ${new Date(rateLimit.resetTime).toISOString()}`, stdout: "", stderr: "", exitCode: -1, durationMs: Date.now() - startTime };
  }
  
  const config = LANGUAGE_CONFIGS[language];
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });
  let container = null;
  
  try {
    try {
      await Promise.race([docker.pull(config.image), new Promise((_, reject) => setTimeout(() => reject(new Error("Image pull timeout")), 30000))]);
    } catch (pullError) {
      console.warn(`Image pull warning for ${config.image}:`, pullError.message);
    }
    
    container = await docker.createContainer({
      Image: config.image,
      Cmd: config.command,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      OpenStdin: false,
      NetworkDisabled: true,
      HostConfig: {
        Memory: parseInt(MEMORY_LIMIT) * 1024 * 1024,
        MemorySwap: parseInt(MEMORY_LIMIT) * 1024 * 1024,
        CpuQuota: CPU_QUOTA,
        CpuPeriod: CPU_PERIOD,
        PidsLimit: PIDS_LIMIT,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=10m" },
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"],
        User: "node",
      },
      WorkingDir: "/tmp",
      Env: [],
    });
    
    const codeBuffer = Buffer.from(config.prepareCode(code), "utf8");
    const tarStream = createTarStream(codeBuffer, config.fileExtension);
    await container.putArchive(tarStream, { path: "/tmp" });
    await container.start();
    
    const waitPromise = container.wait();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timeout")), EXECUTION_TIMEOUT_MS));
    const [result] = await Promise.race([waitPromise, timeoutPromise]);
    
    const logs = await container.logs({ stdout: true, stderr: true, follow: false });
    const { stdout, stderr } = parseDockerLogs(logs);
    
    const durationMs = Date.now() - startTime;
    const exitCode = result.StatusCode ?? -1;
    
    return { executionId, status: exitCode === 0 ? "completed" : "failed", stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr), exitCode, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    let status = "failed";
    let errorMessage = error.message;
    
    if (error.message === "Execution timeout") {
      status = "timeout";
      errorMessage = `Execution timed out after ${EXECUTION_TIMEOUT_MS}ms`;
    }
    
    return { executionId, status, error: errorMessage, stdout: "", stderr: sanitizeOutput(error.message), exitCode: -1, durationMs };
  } finally {
    if (container) {
      try { await container.stop({ t: 1 }); await container.remove({ v: true, force: true }); } catch (cleanupError) { console.error("Container cleanup error:", cleanupError.message); }
    }
  }
}

function createTarStream(content, filename) {
  const header = createTarHeader(filename, content.length);
  return Buffer.concat([header, content, Buffer.alloc((512 - (content.length % 512)) % 512), Buffer.alloc(1024)]);
}

function createTarHeader(filename, size) {
  const header = Buffer.alloc(512);
  Buffer.from(filename.padEnd(100, "\0"), "ascii").copy(header, 0);
  Buffer.from("000644 ".padStart(8, "\0"), "ascii").copy(header, 100);
  Buffer.from("0 ".padStart(8, "\0"), "ascii").copy(header, 108);
  Buffer.from("0 ".padStart(8, "\0"), "ascii").copy(header, 116);
  Buffer.from(size.toString(8).padStart(12, "\0"), "ascii").copy(header, 124);
  Buffer.from("0 ".padStart(12, "\0"), "ascii").copy(header, 136);
  Buffer.from("        ", "ascii").copy(header, 148);
  Buffer.from("0", "ascii").copy(header, 156);
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);
  Buffer.from("node".padEnd(32, "\0"), "ascii").copy(header, 265);
  Buffer.from("node".padEnd(32, "\0"), "ascii").copy(header, 297);
  
  let sum = 0; for (let i = 0; i < 512; i++) sum += header[i];
  Buffer.from(sum.toString(8).padStart(6, "\0") + "\0 ", "ascii").copy(header, 148);
  return header;
}

function parseDockerLogs(logs) {
  let stdout = "", stderr = "";
  if (!logs || logs.length === 0) return { stdout, stderr };
  
  let offset = 0;
  while (offset < logs.length) {
    if (offset + 8 > logs.length) break;
    const streamType = logs[offset];
    const length = logs.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + length > logs.length) break;
    const data = logs.slice(offset, offset + length).toString("utf8");
    offset += length;
    if (streamType === 1) stdout += data; else if (streamType === 2) stderr += data;
  }
  return { stdout, stderr };
}

export { LANGUAGE_CONFIGS, EXECUTION_TIMEOUT_MS, MEMORY_LIMIT, CPU_QUOTA, PIDS_LIMIT };