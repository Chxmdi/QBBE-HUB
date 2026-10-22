import { describe, expect, it, vi } from "vitest";
import { PartialJobFailure, type JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient } from "../support/fake-supabase";

/** Retention never deletes without a record of it, and never hides a lost record. */

vi.mock("@/features/retention/services/retention-subjects", () => ({
  cutoffFor: () => "2026-01-01T00:00:00.000Z",
  SUBJECT_HANDLERS: {
    old_rows: { apply: async () => 3 },
  },
}));

const { applyRetention } = await import("@/features/jobs/services/handlers/apply-retention");

const DEFINITION: JobDefinition = {
  name: "apply-retention",
  description: "test",
  schedule: "40 2 * * *",
  queue: null,
  enabled: true,
  batch_size: 100,
  max_attempts: 1,
} as JobDefinition;

function seeded(subjectKey = "old_rows") {
  const db = new FakeSupabase(new Date("2026-10-22T02:40:00Z"));
  db.seed("retention_policy", [
    { id: "p1", organization_id: "org-1", subject_key: subjectKey, retain_days: 30, action: "delete", enabled: true },
  ]);
  db.seed("retention_run", []);
  return db;
}

const run = (db: FakeSupabase) => applyRetention({ db: asClient(db), definition: DEFINITION, now: db.now() });

describe("apply-retention", () => {
  it("records what it removed", async () => {
    const db = seeded();
    const result = await run(db);
    expect(result.processed).toBe(1);
    expect(db.rows("retention_run")).toMatchObject([{ policy_id: "p1", affected: 3 }]);
  });

  it("fails the run, saying how many rows went, when the record of a deletion cannot be written", async () => {
    const db = seeded();
    db.fail((op) => op.name === "retention_run" && op.kind === "insert");
    const error = await run(db).catch((e) => e);
    expect(error).toBeInstanceOf(PartialJobFailure);
    expect(error.message).toContain("3");
    // Not misreported as a failed policy that removed nothing.
    expect(error.result.failed).toBe(0);
  });

  it("carries on when only the policy's last-run date cannot be updated", async () => {
    const db = seeded();
    db.fail((op) => op.name === "retention_policy" && op.kind === "update");
    const result = await run(db);
    expect(result.processed).toBe(1);
    expect(db.rows("retention_run")).toHaveLength(1);
  });

  it("fails the run when the record of a broken policy cannot be written", async () => {
    const db = seeded("no_such_subject");
    db.fail((op) => op.name === "retention_run" && op.kind === "insert");
    await expect(run(db)).rejects.toBeInstanceOf(PartialJobFailure);
  });
});
