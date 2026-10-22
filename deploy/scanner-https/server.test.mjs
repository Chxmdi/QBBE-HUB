import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createScannerServer } from "./server.mjs";

const token = "test-only-".repeat(4);
async function fixture(options, run) {
  const server = createScannerServer({ token, ready: async () => true, ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/scan`;
  const body = "synthetic bytes";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "X-Content-SHA256": createHash("sha256").update(body).digest("hex") };
  try { await run(url, { method: "POST", headers, body }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test("returns a digest-bound clean verdict", () => fixture({ scan: async () => "clean" }, async (url, options) => {
  const response = await fetch(url, options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: 1, verdict: "clean", sha256: options.headers["X-Content-SHA256"] });
}));
test("returns quarantine verdict", () => fixture({ scan: async () => "quarantined" }, async (url, options) => {
  assert.equal((await (await fetch(url, options)).json()).verdict, "quarantined");
}));
test("rejects unauthorized requests without scanning", () => fixture({ scan: () => assert.fail("must not scan") }, async (url, options) => {
  options.headers.Authorization = "Bearer incorrect";
  assert.equal((await fetch(url, options)).status, 401);
}));
test("rejects digest mismatch without scanning", () => fixture({ scan: () => assert.fail("must not scan") }, async (url, options) => {
  options.body = "different bytes";
  assert.equal((await fetch(url, options)).status, 400);
}));
test("stale signatures leave scanner unavailable", () => fixture({ ready: async () => false, scan: () => assert.fail("must not scan") }, async (url, options) => {
  assert.equal((await fetch(url, options)).status, 503);
}));
test("scanner failure never produces a clean result", () => fixture({ scan: async () => { throw new Error("private failure"); } }, async (url, options) => {
  const response = await fetch(url, options);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "unavailable" });
}));
