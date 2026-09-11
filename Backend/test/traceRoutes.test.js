import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createTraceRouter, traceRequestErrorHandler } from "../routes/traceRoutes.js";
const fakeTraceService = async (code) => {
  if (code === "import os") return { success:false, result:{success:false,status:"unsupported",error:{message:"Unsupported construct"},events:[]} };
  if (code === "1 / 0") return { success:false, result:{success:false,status:"runtime_error",error:{message:"division by zero"},events:[]} };
  return { success:true, result:{success:true,status:"ok",error:null,events:[]} };
};

async function withApi(run) {
  const app = express(); app.use(express.json()); app.use("/api", createTraceRouter(fakeTraceService)); app.use(traceRequestErrorHandler);
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}
async function request(base, body) { const r = await fetch(`${base}/api/trace`, { method:"POST", headers:{"content-type":"application/json"}, body }); return [r.status, await r.json()]; }

test("trace API validates and returns controlled results", async () => withApi(async (base) => {
  let [status, body] = await request(base, JSON.stringify({language:"python",code:"x = 1"})); assert.equal(status,200); assert.equal(body.status,"completed"); assert.ok(body.traceId);
  [status, body] = await request(base, JSON.stringify({language:"python",code:""})); assert.equal(status,400); assert.equal(body.error.code,"INVALID_CODE");
  [status, body] = await request(base, JSON.stringify({language:"javascript",code:"x=1"})); assert.equal(status,400); assert.equal(body.error.code,"UNSUPPORTED_LANGUAGE");
  [status, body] = await request(base, JSON.stringify({language:"python",code:"x".repeat(10001)})); assert.equal(status,413); assert.equal(body.error.code,"SOURCE_TOO_LARGE");
  [status, body] = await request(base, JSON.stringify({language:"python",code:"import os"})); assert.equal(status,422); assert.equal(body.status,"unsupported");
  [status, body] = await request(base, JSON.stringify({language:"python",code:"1 / 0"})); assert.equal(status,400); assert.equal(body.status,"failed");
  [status, body] = await request(base, "{"); assert.equal(status,400); assert.equal(body.error.code,"MALFORMED_REQUEST");
}));
