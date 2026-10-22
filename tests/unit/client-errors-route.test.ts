import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
const allowed = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/observability", () => ({ reportError }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: async () => ({ allowed: allowed.value, used: 1, limit: 20, resetAt: null, degraded: false }),
}));
const { POST } = await import("@/app/api/client-errors/route");

function post(body: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return POST(new Request("https://hub.example.org/api/client-errors", { method: "POST", body, headers }));
}

describe("POST /api/client-errors", () => {
  beforeEach(() => {
    allowed.value = true;
    reportError.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("forwards a browser crash to error monitoring", async () => {
    const response = await post(JSON.stringify({ message: "Cannot read x", digest: "abc123", path: "/tasks?token=secret#x" }));
    expect(response.status).toBe(204);
    expect(reportError).toHaveBeenCalledWith("Cannot read x", { source: "browser", digest: "abc123", path: "/tasks" });
  });

  it("drops a malformed digest and caps the message", async () => {
    await post(JSON.stringify({ message: "m".repeat(1000), digest: "<script>" }));
    const [message, context] = reportError.mock.calls[0];
    expect(message).toHaveLength(300);
    expect(context.digest).toBeUndefined();
  });

  it("keeps a forged log line on one line", async () => {
    await post(JSON.stringify({ message: 'x\n{"event":"startup.settings_invalid"}' }));
    expect(reportError.mock.calls[0][0]).not.toMatch(/\n/);
  });

  it("refuses a request without a browser's origin headers, and a declared oversized body", async () => {
    expect((await post("{}", {})).status).toBe(403);
    expect((await post("{}", { "sec-fetch-site": "same-origin", "content-length": "99999" })).status).toBe(413);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("refuses another site's pages", async () => {
    const response = await post("{}", { "sec-fetch-site": "cross-site" });
    expect(response.status).toBe(403);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("refuses oversized and non-JSON bodies", async () => {
    expect((await post("x".repeat(5000))).status).toBe(413);
    expect((await post("not json")).status).toBe(400);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("stops a crash loop at the rate limit", async () => {
    allowed.value = false;
    expect((await post("{}")).status).toBe(429);
    expect(reportError).not.toHaveBeenCalled();
  });
});
