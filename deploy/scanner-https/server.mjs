import { createServer } from "node:http";
import { createConnection } from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

export function scanClamd(bytes, { host = "clamav", port = 3310 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let reply = "";
    const timer = setTimeout(() => socket.destroy(new Error("scan timeout")), TIMEOUT_MS);
    socket.on("error", reject);
    socket.on("close", () => { clearTimeout(timer); reject(new Error("incomplete scan")); });
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.length > 4096) socket.destroy(new Error("invalid scan response"));
    });
    socket.on("end", () => {
      if (reply === "stream: OK\0") resolve("clean");
      else if (/^stream: [^\0\r\n]+ FOUND\0$/.test(reply)) resolve("quarantined");
      else reject(new Error("invalid scan response"));
      socket.destroy();
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
      if (bytes.length) { socket.write(size); socket.write(bytes); }
      socket.write(Buffer.alloc(4));
    });
  });
}

export async function signaturesFresh(directory = "/var/lib/clamav", now = Date.now()) {
  for (const file of ["daily.cvd", "daily.cld"]) {
    try {
      const metadata = await stat(`${directory}/${file}`);
      if (metadata.size > 0 && now - metadata.mtimeMs < 72 * 60 * 60 * 1000 && metadata.mtimeMs <= now) return true;
    } catch { /* The other database format may be installed. */ }
  }
  return false;
}

export function createScannerServer({ token, scan = scanClamd, ready = signaturesFresh, concurrency = 2 }) {
  if (typeof token !== "string" || token.length < 32 || /[\r\n]/.test(token)) throw new Error("Set a scanner token of at least 32 characters");
  const expected = createHash("sha256").update(`Bearer ${token}`).digest();
  let active = 0;
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      }
    };
    const provided = createHash("sha256").update(req.headers.authorization ?? "").digest();
    if (!timingSafeEqual(expected, provided)) { reply(401, { error: "unauthorized" }); return; }
    if (req.url === "/health" && req.method === "GET") {
      try {
        if (!await ready() || await scan(Buffer.alloc(0)) !== "clean") throw new Error("not ready");
        reply(200, { status: "ready" });
      } catch { reply(503, { status: "unavailable" }); }
      return;
    }
    if (req.url !== "/v1/scan" || req.method !== "POST") { reply(404, { error: "not_found" }); return; }
    if (req.headers["content-type"] !== "application/octet-stream") { reply(415, { error: "content_type" }); return; }
    const wantedHash = req.headers["x-content-sha256"];
    if (typeof wantedHash !== "string" || !/^[a-f0-9]{64}$/.test(wantedHash)) { reply(400, { error: "digest_required" }); return; }
    if (active >= concurrency) { reply(429, { error: "busy" }); return; }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BYTES) { reply(413, { error: "too_large" }); return; }
    active++;
    const timer = setTimeout(() => { reply(503, { error: "unavailable" }); req.destroy(); }, TIMEOUT_MS + 1000);
    try {
      if (!await ready()) { reply(503, { error: "unavailable" }); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) { reply(413, { error: "too_large" }); return; }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, size);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== wantedHash) { reply(400, { error: "digest_mismatch" }); return; }
      const verdict = await scan(bytes);
      if (!["clean", "quarantined"].includes(verdict)) throw new Error("invalid verdict");
      reply(200, { version: 1, sha256, verdict });
    } catch { reply(503, { error: "unavailable" }); }
    finally { clearTimeout(timer); active--; }
  });
  server.requestTimeout = TIMEOUT_MS + 1000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 30;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createScannerServer({ token: process.env.SCANNER_HTTPS_TOKEN }).listen(8080, "0.0.0.0");
}
