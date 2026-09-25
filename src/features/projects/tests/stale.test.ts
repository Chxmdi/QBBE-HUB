import { describe, expect, it } from "vitest";
import { cadenceDays, isProjectStale } from "@/features/projects/stale";

const now = new Date("2026-09-23T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

describe("isProjectStale", () => {
  it("treats a project with no cadence as never stale", () => {
    expect(
      isProjectStale(
        { reporting_cadence: "none", stage: "active", created_at: daysAgo(90) },
        now,
      ),
    ).toBe(false);
    expect(cadenceDays("none")).toBeNull();
  });

  it("flags a weekly project whose last status update is older than 7 days", () => {
    expect(
      isProjectStale(
        {
          reporting_cadence: "weekly",
          stage: "active",
          created_at: daysAgo(30),
          last_status_update_at: daysAgo(8),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isProjectStale(
        {
          reporting_cadence: "weekly",
          stage: "active",
          created_at: daysAgo(30),
          last_status_update_at: daysAgo(6),
        },
        now,
      ),
    ).toBe(false);
  });

  it("uses 30 days for a monthly cadence and creation when no update exists", () => {
    expect(cadenceDays("monthly")).toBe(30);
    expect(
      isProjectStale(
        { reporting_cadence: "monthly", stage: "active", created_at: daysAgo(31) },
        now,
      ),
    ).toBe(true);
    expect(
      isProjectStale(
        { reporting_cadence: "monthly", stage: "active", created_at: daysAgo(10) },
        now,
      ),
    ).toBe(false);
  });

  it("does not flag a closed or archived project", () => {
    expect(
      isProjectStale(
        {
          reporting_cadence: "weekly",
          stage: "completed",
          created_at: daysAgo(40),
        },
        now,
      ),
    ).toBe(false);
    expect(
      isProjectStale(
        {
          reporting_cadence: "weekly",
          stage: "active",
          archived_at: daysAgo(1),
          created_at: daysAgo(40),
        },
        now,
      ),
    ).toBe(false);
  });
});
