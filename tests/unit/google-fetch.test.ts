import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { GoogleFetchError, googleFetch, retryAfterMs } from "@/features/inbox/services/google-fetch";

const answer = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

describe("googleFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives up on a call that never answers, within the timeout, with an error health reads as delayed", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    const started = Date.now();
    const error = await googleFetch("https://www.googleapis.com/x", {}, { timeoutMs: 50, retries: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(GoogleFetchError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(classifyIntegrationFailure(error.message)).toBe("synchronization_delayed");
  });

  it("retries a 429 after the Retry-After delay, then returns the final answer", async () => {
    const calls: number[] = [];
    vi.stubGlobal("fetch", async () => (calls.push(1), answer(429, { "retry-after": "2" })));
    const waits: number[] = [];
    const response = await googleFetch("https://gmail.googleapis.com/x", {}, { retries: 1, sleep: async (ms) => void waits.push(ms) });
    expect(response.status).toBe(429);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it("backs off on 5xx with growing delays up to the cap, and stops on success", async () => {
    const statuses = [503, 500, 200];
    vi.stubGlobal("fetch", async () => answer(statuses.shift()!));
    const waits: number[] = [];
    const response = await googleFetch("https://x", {}, { retries: 3, maxDelayMs: 1500, sleep: async (ms) => void waits.push(ms) });
    expect(response.status).toBe(200);
    expect(waits).toEqual([1000, 1500]);
  });

  it("never repeats a write that could be duplicated, unless told to", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => (calls++, answer(503)));
    await googleFetch("https://x", { method: "POST" }, { retries: 3, sleep: async () => {} });
    expect(calls).toBe(1);
    await googleFetch("https://x", { method: "POST" }, { retries: 2, retryUnsafe: true, sleep: async () => {} });
    expect(calls).toBe(4);
  });

  it("reads Retry-After as seconds or a date", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs("soon")).toBeNull();
  });
});
