import express from "express";
import { randomUUID } from "node:crypto";
import { runPythonTrace } from "../services/pythonTraceService.js";

const MAX_SOURCE_CHARS = 10_000;

function sendFailure(res, status, code, message, traceId = null) {
  return res.status(status).json({ traceId, status: status === 422 ? "unsupported" : "invalid", error: { code, message } });
}

export function createTraceRouter(traceService = runPythonTrace) {
  const router = express.Router();
  router.post("/trace", async (req, res) => {
    const { language, code } = req.body || {};
    if (language !== "python") return sendFailure(res, 400, "UNSUPPORTED_LANGUAGE", "Only Python tracing is supported.");
    if (typeof code !== "string" || !code.trim()) return sendFailure(res, 400, "INVALID_CODE", "Code must be a non-empty string.");
    if (code.length > MAX_SOURCE_CHARS) return sendFailure(res, 413, "SOURCE_TOO_LARGE", `Code exceeds ${MAX_SOURCE_CHARS} characters.`);

    const traceId = randomUUID();
    const serviceResult = await traceService(code);
    if (!serviceResult.success && !serviceResult.result) {
      const status = serviceResult.code === "TRACE_BUSY" ? 429 : 500;
      return res.status(status).json({ traceId, status: "failed", error: { code: serviceResult.code, message: serviceResult.message } });
    }
    const trace = serviceResult.result;
    if (trace.success) return res.status(200).json({ traceId, status: "completed", trace });
    const unsupported = trace.status === "unsupported";
    const invalid = ["invalid_source", "source_limit", "syntax_error"].includes(trace.status);
    return res.status(unsupported ? 422 : 400).json({
      traceId,
      status: unsupported ? "unsupported" : invalid ? "invalid" : "failed",
      error: { code: String(trace.status || "TRACE_FAILED").toUpperCase(), message: trace.error?.message || "Trace generation failed." },
    });
  });
  return router;
}

export function traceRequestErrorHandler(error, _req, res, next) {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ traceId: null, status: "invalid", error: { code: "MALFORMED_REQUEST", message: "Request body must be valid JSON." } });
  }
  return next(error);
}
