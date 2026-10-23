import { describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../support/fake-supabase";

// The first test loads the whole job handler, which takes seconds on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

/**
 * google-sync handles at most batch_size connections per run, least recently
 * touched first, so a large or slow set of accounts is spread over several
 * runs instead of holding one run open.
 */
let db: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => db }));

describe("google-sync per-run budget", () => {
  it("takes batch_size connections, oldest first, and leaves the rest for the next run", async () => {
    db = new FakeSupabase();
    const base = Date.parse("2026-11-01T00:00:00Z");
    db.seed(
      "integration_connection",
      Array.from({ length: 120 }, (_, i) => ({
        id: `c${i}`,
        organization_id: "org",
        user_id: null,
        provider: "gmail",
        status: "connected",
        updated_at: new Date(base + (120 - i) * 60_000).toISOString(),
      })),
    );
    db.seed("background_job_run", []);
    const { googleSync } = await import("@/features/jobs/services/handlers/google-sync");
    const result = await googleSync({
      db: db as never,
      definition: { name: "google-sync", description: "", schedule: "", queue: null, enabled: true, batch_size: 50, max_attempts: 5 },
      now: new Date("2026-11-20T00:00:00Z"),
    });
    expect(result.processed + result.failed).toBe(50);
    // The 50 least recently touched are c70..c119.
    const touched = db.rows("integration_connection").filter((row) => row.last_error).map((row) => row.id);
    expect(touched).toHaveLength(50);
    expect(touched).toContain("c119");
    expect(touched).not.toContain("c0");
  });
});
