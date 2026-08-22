import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitMessage,
} from "@/lib/rate-limit";

/**
 * The limiter's own behaviour under stress: what it says to a person who hits
 * a ceiling, and what it does when the limiter itself is the thing that broke.
 *
 * The counting is Postgres's job and is verified against a real database; what
 * matters here is that a broken limiter never becomes an outage.
 */

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ rpc }),
}));

afterEach(() => {
  rpc.mockReset();
});

const rule = { action: "message:create", subject: "user-1", limit: 3, windowSeconds: 60 };

describe("checkRateLimit", () => {
  it("passes a request inside the ceiling through", async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: true, used: 1, reset_at: "2026-08-20T12:01:00Z" }],
      error: null,
    });

    const result = await checkRateLimit(rule);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.degraded).toBe(false);
  });

  it("refuses one over the ceiling", async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: false, used: 4, reset_at: "2026-08-20T12:01:00Z" }],
      error: null,
    });

    const result = await checkRateLimit(rule);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(4);
  });

  it("keys the counter by action and subject together", async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: true, used: 1, reset_at: "2026-08-20T12:01:00Z" }],
      error: null,
    });

    await checkRateLimit(rule);
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_bucket: "message:create:user-1",
      p_limit: 3,
      p_window_seconds: 60,
    });
  });

  it("fails open when the limiter errors, rather than blocking the workspace", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkRateLimit(rule);
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
    // Failing open silently would hide the outage; it must be visible.
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("fails open when the limiter is not configured at all", async () => {
    rpc.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY is not set"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkRateLimit(rule);
    expect(result).toMatchObject({ allowed: true, degraded: true });
    logged.mockRestore();
  });
});

describe("rateLimitMessage", () => {
  it("tells the person how long to wait, in seconds", () => {
    const resetAt = new Date(Date.now() + 20_000);
    expect(rateLimitMessage({ allowed: false, used: 4, limit: 3, resetAt, degraded: false }))
      .toMatch(/about 20 seconds/);
  });

  it("switches to minutes for a longer wait", () => {
    const resetAt = new Date(Date.now() + 10 * 60_000);
    expect(rateLimitMessage({ allowed: false, used: 4, limit: 3, resetAt, degraded: false }))
      .toMatch(/about 10 minutes/);
  });

  it("stays useful when there is no reset time to quote", () => {
    const message = rateLimitMessage({
      allowed: false, used: 4, limit: 3, resetAt: null, degraded: true,
    });
    expect(message).toContain("try again");
  });
});

describe("the configured ceilings", () => {
  it("are all positive and windowed", () => {
    for (const [action, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, action).toBeGreaterThan(0);
      expect(rule.windowSeconds, action).toBeGreaterThan(0);
    }
  });

  it("leave the busiest job far more headroom than its schedule needs", () => {
    // drain-notifications runs once a minute; anything near that would be a bug.
    expect(RATE_LIMITS["job:run"].limit).toBeGreaterThan(60);
  });
});
