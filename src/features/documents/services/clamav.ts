import { createConnection, type NetConnectOpts } from "node:net";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Where the scanner listens. Either a private Unix socket on the same host
 * (`CLAMAV_SOCKET`) or a clamd reachable over the network
 * (`CLAMAV_HOST`, with `CLAMAV_PORT` defaulting to clamd's 3310). The network
 * form is what a serverless deployment uses: clamd runs on a QBBE-controlled
 * host or container, and the job route reaches it over a private network.
 * clamd's protocol has no authentication, so the host must never be reachable
 * from the public internet.
 */
export type ScannerAddress = { path: string } | { host: string; port: number };

type ScannerEnv = Record<string, string | undefined>;

export function scannerAddress(env: ScannerEnv = process.env): ScannerAddress | null {
  const path = env.CLAMAV_SOCKET?.trim();
  if (path) return { path };
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = env.CLAMAV_PORT?.trim() ? Number.parseInt(env.CLAMAV_PORT, 10) : 3310;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CLAMAV_PORT must be a port number");
  }
  return { host, port };
}

/** The one-line requirement every scanning job names when it cannot run. */
export const SCANNER_REQUIREMENT = "a scanner: set CLAMAV_SOCKET (Unix socket) or CLAMAV_HOST and CLAMAV_PORT (clamd over TCP)";

export function isScannerConfigured(env: ScannerEnv = process.env): boolean {
  return scannerAddress(env) !== null;
}

/** Only an explicit ClamAV clean verdict releases a file. */
export function parseScanReply(reply: string): "clean" | "quarantined" {
  if (reply === "stream: OK\0") return "clean";
  if (/^stream: [^\0\r\n]+ FOUND\0$/.test(reply)) return "quarantined";
  throw new Error("Scanner did not return a valid verdict");
}

/** INSTREAM to clamd; the scanner never receives a file path. */
export async function scanDocumentBytes(
  bytes: Uint8Array,
  address: ScannerAddress | null = scannerAddress(),
): Promise<"clean" | "quarantined"> {
  if (!address) throw new Error(`Scanning requires ${SCANNER_REQUIREMENT}`);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("File exceeds the scan limit");
  const options: NetConnectOpts = "path" in address ? { path: address.path } : { host: address.host, port: address.port };
  return new Promise((resolve, reject) => {
    const socket = createConnection(options);
    let reply = "";
    const timer = setTimeout(() => socket.destroy(new Error("Scanner timed out")), 15_000);
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timer);
      reject(new Error("Scanner connection closed before completion"));
    });
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("utf8");
      if (reply.length > 4096) socket.destroy(new Error("Scanner response exceeded the limit"));
    });
    socket.on("end", () => {
      try { resolve(parseScanReply(reply)); } catch (error) { reject(error); }
      socket.destroy();
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const size = Buffer.alloc(4);
      size.writeUInt32BE(bytes.byteLength);
      if (bytes.byteLength) {
        socket.write(size);
        socket.write(bytes);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
