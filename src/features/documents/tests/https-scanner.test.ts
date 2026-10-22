import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { MAX_DOCUMENT_BYTES, scanDocumentBytes, scannerAddress } from "../services/clamav";

const bytes = new TextEncoder().encode("synthetic document");
const address = { url: "https://scanner.example/v1/scan", token: "t".repeat(32) };
const sha256 = createHash("sha256").update(bytes).digest("hex");
afterEach(() => vi.unstubAllGlobals());

describe("HTTPS scanner", () => {
  it("selects HTTPS and refuses partial or insecure configuration", () => {
    expect(scannerAddress({ SCANNER_HTTPS_URL: address.url, SCANNER_HTTPS_TOKEN: address.token })).toEqual(address);
    for (const env of [
      { SCANNER_HTTPS_URL: address.url },
      { SCANNER_HTTPS_TOKEN: address.token },
      { SCANNER_HTTPS_URL: "http://scanner.example", SCANNER_HTTPS_TOKEN: address.token },
      { SCANNER_HTTPS_URL: "https://user:pass@scanner.example", SCANNER_HTTPS_TOKEN: address.token },
      { SCANNER_HTTPS_URL: address.url + "?token=x", SCANNER_HTTPS_TOKEN: address.token },
    ]) expect(() => scannerAddress(env)).toThrow();
  });
  it.each(["clean", "quarantined"])("accepts a matching %s verdict", async (verdict) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ version: 1, sha256, verdict }));
    vi.stubGlobal("fetch", fetcher);
    expect(await scanDocumentBytes(bytes, address)).toBe(verdict);
    expect(fetcher).toHaveBeenCalledWith(address.url, expect.objectContaining({
      method: "POST", body: bytes, redirect: "error", cache: "no-store",
      headers: expect.objectContaining({ "X-Content-SHA256": sha256, Authorization: `Bearer ${address.token}` }),
    }));
  });
  it.each([
    { version: 1, sha256: "wrong", verdict: "clean" },
    { version: 2, sha256, verdict: "clean" },
    { version: 1, sha256, verdict: "unknown" },
    null,
  ])("does not release bytes for an invalid verdict", async (result) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result)));
    await expect(scanDocumentBytes(bytes, address)).rejects.toThrow("HTTPS scanner unavailable");
  });
  it.each([new Response("unavailable", { status: 503 }), new Response("x".repeat(4097)), new Response("not json")])("rejects failed, oversized or malformed responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(scanDocumentBytes(bytes, address)).rejects.toThrow("HTTPS scanner unavailable");
  });
  it("does not leak transport errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(address.token)));
    await expect(scanDocumentBytes(bytes, address)).rejects.toThrow(/^HTTPS scanner unavailable or returned an invalid verdict$/);
  });
  it("rejects oversized uploads before contacting the service", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(scanDocumentBytes(new Uint8Array(MAX_DOCUMENT_BYTES + 1), address)).rejects.toThrow("scan limit");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
