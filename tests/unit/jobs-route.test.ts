import { beforeEach, describe, expect, it, vi } from "vitest";

// The scheduler's entry point: only a caller holding the job secret starts a
// job, and nothing about a refusal or a failure leaks into the response.

const SECRET = "s".repeat(40);
let limited = false;
let run: (job: string) => Promise<unknown> = async () => ({});

vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => limited }));
vi.mock("@/features/jobs/services/runner", async () => {
  class UnknownJobError extends Error {}
  class DisabledJobError extends Error {}
  return { UnknownJobError, DisabledJobError, runJob: (job: string) => run(job) };
});

const { POST } = await import("@/app/api/jobs/[job]/route");
const runner = await import("@/features/jobs/services/runner");
const { MissingEnvError } = await import("@/lib/env");

function call(job: string, secret?: string | null) {
  const headers = new Headers();
  if (secret) headers.set("x-job-secret", secret);
  return POST(new Request(`http://localhost/api/jobs/${job}`, { method: "POST", headers }), {
    params: Promise.resolve({ job }),
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_JOB_SECRET", SECRET);
  limited = false;
  run = vi.fn(async (job: string) => ({ jobName: job, status: "succeeded", processed: 3, failed: 0, durationMs: 12 }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/jobs/[job]", () => {
  it("runs the job for the scheduler and reports its outcome", async () => {
    const response = await call("send-digests", SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: "send-digests", status: "succeeded", processed: 3, failed: 0, durationMs: 12 });
  });

  it("refuses a missing, wrong or wrong-length secret before doing anything", async () => {
    for (const secret of [null, "", "x".repeat(40), SECRET.slice(1), `${SECRET}x`]) {
      const response = await call("send-digests", secret);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses everyone when no secret is configured, rather than accepting an empty one", async () => {
    vi.stubEnv("CRON_JOB_SECRET", "");
    expect((await call("send-digests", "anything")).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("stops a caller that runs a job faster than any schedule would", async () => {
    limited = true;
    const response = await call("send-digests", SECRET);
    expect(response.status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  });

  it("names unknown, disabled and misconfigured jobs without exposing internals", async () => {
    run = async () => {
      throw new runner.UnknownJobError("nope");
    };
    expect((await call("nope", SECRET)).status).toBe(404);
    run = async () => {
      throw new runner.DisabledJobError("off");
    };
    expect((await call("off", SECRET)).status).toBe(409);
    run = async () => {
      throw new MissingEnvError("SMTP_HOST");
    };
    expect((await call("send-digests", SECRET)).status).toBe(503);
    run = async () => {
      throw new Error(`connection to db failed with ${SECRET}`);
    };
    const failed = await call("send-digests", SECRET);
    expect(failed.status).toBe(500);
    const body = JSON.stringify(await failed.json());
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("connection");
  });

  it("returns 200 for a run that failed, with the failure recorded in the body", async () => {
    run = async (job) => ({ jobName: job, status: "failed", processed: 0, failed: 2, durationMs: 5, error: "2 sends failed" });
    const response = await call("send-digests", SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed", failed: 2, error: "2 sends failed" });
  });
});
