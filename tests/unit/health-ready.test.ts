import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let status = "ready";
vi.mock("@/features/jobs/services/runner-status", () => ({
  getJobRunnerStatus: async () => status,
}));
const { GET } = await import("@/app/api/health/ready/route");

const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  CRON_JOB_SECRET: "s".repeat(40),
  NEXT_PUBLIC_APP_URL: "https://hub.example.org",
};

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    status = "ready";
    for (const [k, v] of Object.entries(GOOD)) vi.stubEnv(k, v);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 200 when settings are complete and the database answers the service key", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, checks: { settings: "ok", database: "ok" } });
  });

  it("stays ready before the job runner is configured (a new environment)", async () => {
    status = "not_configured";
    expect((await GET()).status).toBe(200);
  });

  it("answers 503 when the service key does not work", async () => {
    status = "unknown";
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.database).toBe("failed");
  });

  it("answers 503 for missing settings without naming or echoing them", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await GET();
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(text).toContain('"settings":"failed"');
  });
});
