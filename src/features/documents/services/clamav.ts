import { createConnection } from "node:net";

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Only an explicit ClamAV clean verdict releases a file. */
export function parseScanReply(reply: string): "clean" | "quarantined" {
  if (reply === "stream: OK\0") return "clean";
  if (/^stream: [^\0\r\n]+ FOUND\0$/.test(reply)) return "quarantined";
  throw new Error("Scanner did not return a valid verdict");
}

/** INSTREAM over a private Unix socket; the scanner never receives a file path. */
export async function scanDocumentBytes(bytes: Uint8Array): Promise<"clean" | "quarantined"> {
  const path = process.env.CLAMAV_SOCKET;
  if (!path) throw new Error("CLAMAV_SOCKET is not configured");
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("File exceeds the scan limit");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path });
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
