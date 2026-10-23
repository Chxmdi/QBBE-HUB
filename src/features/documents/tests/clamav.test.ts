import { describe, expect, it } from "vitest";
import { parseScanReply, parseScanResult, scanNote } from "../services/clamav";
import { isReleasable, quarantineReason } from "../quarantine-reason";

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
      expect(await scanDocumentBytes(new TextEncoder().encode("hello"), address)).toEqual({ verdict: "clean", signature: null });
      seen.length = 0;
      expect(await scanDocumentBytes(new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"), address))
        .toEqual({ verdict: "quarantined", signature: "Eicar-Test-Signature" });
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

describe("what a quarantine records and tells the uploader", () => {
  it("keeps the scanner's verdict name", () => {
    expect(parseScanResult("stream: Heuristics.Encrypted.PDF FOUND\0"))
      .toEqual({ verdict: "quarantined", signature: "Heuristics.Encrypted.PDF" });
    expect(scanNote({ verdict: "quarantined", signature: "Heuristics.Encrypted.Zip" })).toBe("Heuristics.Encrypted.Zip");
    expect(scanNote({ verdict: "clean", signature: null })).toBe("ClamAV scan completed");
    expect(scanNote("rejected")).toBe("File exceeds 25 MB");
  });

  it("explains a password-protected file, a virus, a file too large and a deleted file differently", () => {
    expect(quarantineReason("quarantined", "Heuristics.Encrypted.PDF")).toBe("passwordProtected");
    expect(quarantineReason("quarantined", "Heuristics.Encrypted.Zip")).toBe("passwordProtected");
    expect(quarantineReason("quarantined", "Eicar-Test-Signature")).toBe("virus");
    expect(quarantineReason("quarantined", "ClamAV scan completed")).toBe("virus");
    expect(quarantineReason("rejected", "File exceeds 25 MB")).toBe("tooLarge");
    expect(quarantineReason("quarantined", "Deleted by an administrator; the scanner reported Eicar-Test-Signature")).toBe("deleted");
    expect(quarantineReason("clean", "Released by an administrator; the scanner reported Heuristics.Encrypted.PDF")).toBeNull();
  });

  it("offers release only for a password-protected PDF", () => {
    expect(isReleasable("quarantined", "Heuristics.Encrypted.PDF")).toBe(true);
    expect(isReleasable("quarantined", "Heuristics.Encrypted.Zip")).toBe(false);
    expect(isReleasable("quarantined", "Heuristics.Limits.Exceeded.MaxRecursion")).toBe(false);
    expect(isReleasable("quarantined", "Eicar-Test-Signature")).toBe(false);
    expect(isReleasable("rejected", "Heuristics.Encrypted.PDF")).toBe(false);
  });
});
