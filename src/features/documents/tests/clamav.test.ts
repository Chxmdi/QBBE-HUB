import { describe, expect, it } from "vitest";
import { parseScanReply } from "../services/clamav";

describe("ClamAV verdict validation", () => {
  it("accepts only an explicit clean response", () => {
    expect(parseScanReply("stream: OK\0")).toBe("clean");
    expect(parseScanReply("stream: Eicar-Signature FOUND\0")).toBe("quarantined");
  });
  it.each(["", "stream: OK", "stream: timeout ERROR\0", "stream: OK\0stream: virus FOUND\0"])(
    "refuses incomplete or ambiguous replies: %s", (reply) => {
      expect(() => parseScanReply(reply)).toThrow();
    },
  );
});

describe("scanner address", () => {
  it("prefers the Unix socket, then clamd over TCP, else nothing", async () => {
    const { scannerAddress, isScannerConfigured } = await import("../services/clamav");
    expect(scannerAddress({})).toBeNull();
    expect(isScannerConfigured({})).toBe(false);
    expect(scannerAddress({ CLAMAV_SOCKET: "/run/clamav/clamd.ctl" })).toEqual({ path: "/run/clamav/clamd.ctl" });
    expect(scannerAddress({ CLAMAV_HOST: "clamav.internal" })).toEqual({ host: "clamav.internal", port: 3310 });
    expect(scannerAddress({ CLAMAV_HOST: "10.0.0.5", CLAMAV_PORT: "3311" })).toEqual({ host: "10.0.0.5", port: 3311 });
    expect(() => scannerAddress({ CLAMAV_HOST: "10.0.0.5", CLAMAV_PORT: "nope" })).toThrow();
  });
});

describe("scanning over TCP", () => {
  it("streams the bytes with INSTREAM and reads the verdict", async () => {
    const { createServer } = await import("node:net");
    const { scanDocumentBytes } = await import("../services/clamav");
    const seen: Buffer[] = [];
    const server = createServer((socket) => {
      socket.on("data", (chunk) => {
        seen.push(chunk);
        const all = Buffer.concat(seen);
        // The stream ends with a zero-length chunk marker.
        if (all.length >= 4 && all.subarray(all.length - 4).equals(Buffer.alloc(4))) {
          const body = all.toString("latin1");
          socket.end(body.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const address = { host: "127.0.0.1", port };
    try {
      expect(await scanDocumentBytes(new TextEncoder().encode("hello"), address)).toBe("clean");
      seen.length = 0;
      expect(await scanDocumentBytes(new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"), address)).toBe("quarantined");
      expect(Buffer.concat(seen).subarray(0, 10).toString("latin1")).toBe("zINSTREAM\0");
    } finally {
      server.close();
    }
  });
  it("refuses to scan when no scanner is configured", async () => {
    const { scanDocumentBytes } = await import("../services/clamav");
    await expect(scanDocumentBytes(new Uint8Array(1), null)).rejects.toThrow(/CLAMAV_SOCKET/);
  });
});
