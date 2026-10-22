import { describe, expect, it } from "vitest";
import { scheduleIntervalMs } from "@/features/jobs/services/cron";
import { isOverdue, runLabel, runOutcome, runTone } from "@/features/jobs/services/run-health";
import { summaryToRun } from "@/features/jobs/services/jobs.queries";
import { createTranslator } from "@/lib/i18n/translate";

const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE = 60_000;
const DAY = 86_400_000;

describe("job schedule intervals", () => {
  it("reads per-minute, daily and weekly schedules", () => {
    expect(scheduleIntervalMs("* * * * *", NOW)).toBe(MINUTE);
    expect(scheduleIntervalMs("*/15 * * * *", NOW)).toBe(15 * MINUTE);
    expect(scheduleIntervalMs("40 2 * * *", NOW)).toBe(DAY);
    expect(scheduleIntervalMs("0 10 * * 1", NOW)).toBe(7 * DAY);
    expect(scheduleIntervalMs("0 9 * * 1-5", NOW)).toBe(3 * DAY);
  });
});

describe("overdue jobs", () => {
  it("is overdue only past three intervals, and never when disabled or never run", () => {
    expect(isOverdue(true, ago(3 * MINUTE - 1000), MINUTE, NOW)).toBe(false);
    expect(isOverdue(true, ago(3 * MINUTE + 1000), MINUTE, NOW)).toBe(true);
    expect(isOverdue(true, ago(2 * DAY), DAY, NOW)).toBe(false);
    expect(isOverdue(true, ago(4 * DAY), DAY, NOW)).toBe(true);
    expect(isOverdue(false, ago(4 * DAY), DAY, NOW)).toBe(false);
    expect(isOverdue(true, null, DAY, NOW)).toBe(false);
  });

  it("turns a stale green run red, but keeps a failed run's own label", () => {
    const ok = { status: "succeeded" as const, processedCount: 3, failedCount: 0 };
    const failed = { status: "failed" as const, processedCount: 0, failedCount: 0 };
    expect(runOutcome(ok, true)).toBe("overdue");
    expect(runTone("overdue")).toBe("danger");
    expect(runOutcome(failed, true)).toBe("failed");
    expect(runOutcome(ok)).toBe("succeeded");
    expect(runLabel("overdue", ok, createTranslator("en"))).toBe("Overdue");
    expect(runLabel("overdue", ok, createTranslator("fr-CA"))).toBe("En retard");
  });

  it("reads the summary row's latest run, so a daily failure shows failed, not never run", () => {
    const run = summaryToRun({
      job_name: "apply-retention",
      last_run_id: "r1",
      last_status: "failed",
      last_started_at: ago(10 * 3_600_000),
      last_finished_at: ago(10 * 3_600_000),
      last_duration_ms: 10,
      last_processed_count: 0,
      last_failed_count: 0,
      last_error: "Dispatch failed: HTTP 403",
      last_metadata: null,
      failures_24h: 1,
    });
    expect(runOutcome(run)).toBe("failed");
    expect(run.error).toBe("Dispatch failed: HTTP 403");
  });
});
