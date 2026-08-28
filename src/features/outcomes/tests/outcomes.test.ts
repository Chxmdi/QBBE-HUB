import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contactHours,
  createMetricSchema,
  metricProgress,
  recordMeasurementSchema,
  recordOperationSchema,
  summarizeDelivery,
} from "@/features/outcomes/schemas";
import { withProgress } from "@/features/outcomes/services/outcome.queries";
import type { MetricRow } from "@/features/outcomes/services/outcome.queries";

const PROGRAM = "11111111-1111-4111-8111-111111111111";

function migration(): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((n) => n.endsWith("_outcomes_and_delivery.sql"));
  if (!file) throw new Error("the outcomes migration is missing");
  return readFileSync(join(dir, file), "utf8");
}

describe("contact hours", () => {
  it("matches the generated column's arithmetic", () => {
    // The database stores attendee_count * duration_hours. A form that showed
    // a different number before saving would be lying about what it will save.
    const sql = migration();
    expect(sql).toContain("attendee_count * duration_hours");
    expect(contactHours(24, 2.5)).toBe(60);
  });

  it("is unknown rather than zero when either input is missing", () => {
    expect(contactHours(null, 2)).toBeNull();
    expect(contactHours(10, null)).toBeNull();
  });
});

describe("delivery totals", () => {
  const op = (
    status: "planned" | "delivered" | "cancelled",
    attendees: number | null,
    hours: string | null,
  ) => ({
    status,
    attendee_count: attendees,
    contact_hours: hours,
    volunteer_count: 2,
  });

  it("counts only what was actually delivered", () => {
    // Including planned or cancelled sessions is the specific way these
    // figures overstate delivery in a funder report.
    const summary = summarizeDelivery([
      op("delivered", 20, "40.0"),
      op("delivered", 15, "30.0"),
      op("planned", null, null),
      op("cancelled", null, null),
    ]);
    expect(summary.delivered).toBe(2);
    expect(summary.attendees).toBe(35);
    expect(summary.contactHours).toBe(70);
    expect(summary.planned).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it("handles an empty program without producing NaN", () => {
    const summary = summarizeDelivery([]);
    expect(summary).toEqual({
      delivered: 0,
      planned: 0,
      cancelled: 0,
      attendees: 0,
      contactHours: 0,
      volunteerSessions: 0,
    });
  });
});

describe("progress toward a target", () => {
  it("measures from the baseline, not from zero", () => {
    // 4.1 → 6.8, currently 5.45: half way, not 80%.
    const progress = metricProgress({
      direction: "increase",
      baseline: 4.1,
      target: 6.8,
      latest: 5.45,
    });
    expect(progress.percent).toBe(50);
    expect(progress.met).toBe(false);
  });

  it("treats a falling number as progress when lower is better", () => {
    const progress = metricProgress({
      direction: "decrease",
      baseline: 80,
      target: 20,
      latest: 50,
    });
    expect(progress.percent).toBe(50);
    expect(progress.regressed).toBe(false);
  });

  it("calls a rising number a regression when lower is better", () => {
    const progress = metricProgress({
      direction: "decrease",
      baseline: 80,
      target: 20,
      latest: 95,
    });
    expect(progress.regressed).toBe(true);
    expect(progress.percent).toBe(0);
  });

  it("recognises a met target in both directions", () => {
    expect(
      metricProgress({ direction: "increase", baseline: 4, target: 7, latest: 7 }).met,
    ).toBe(true);
    expect(
      metricProgress({ direction: "decrease", baseline: 80, target: 20, latest: 12 }).met,
    ).toBe(true);
  });

  it("clamps past the target rather than reporting 140%", () => {
    const progress = metricProgress({
      direction: "increase",
      baseline: 0,
      target: 10,
      latest: 14,
    });
    expect(progress.percent).toBe(100);
    expect(progress.met).toBe(true);
  });

  it("says nothing when there is nothing to say", () => {
    expect(
      metricProgress({ direction: "increase", baseline: null, target: 10, latest: 5 })
        .percent,
    ).toBeNull();
    expect(
      metricProgress({ direction: "increase", baseline: 1, target: 10, latest: null })
        .percent,
    ).toBeNull();
  });

  it("survives a baseline equal to its target without dividing by zero", () => {
    // The database refuses this, but an older row or an imported one must not
    // put Infinity on a screen.
    const progress = metricProgress({
      direction: "increase",
      baseline: 5,
      target: 5,
      latest: 5,
    });
    expect(progress.percent).toBeNull();
    expect(Number.isFinite(progress.change ?? 0)).toBe(true);
  });
});

describe("picking the latest reading", () => {
  it("does not trust the order an embedded select returned", () => {
    // PostgREST gives no ordering guarantee on an embedded resource, so the
    // newest reading is chosen by date rather than by position.
    const metric = {
      id: "m1",
      name: "Reading confidence",
      description: null,
      unit: "score",
      direction: "increase" as const,
      baseline: "4.1",
      baseline_on: null,
      target: "6.8",
      target_on: null,
      retired_at: null,
      owner: null,
      measurements: [
        { id: "a", measured_on: "2026-01-01", value: "4.5", source: null, sample_size: null, note: null },
        { id: "c", measured_on: "2026-06-01", value: "6.0", source: null, sample_size: null, note: null },
        { id: "b", measured_on: "2026-03-01", value: "5.2", source: null, sample_size: null, note: null },
      ],
    } satisfies MetricRow;

    const result = withProgress(metric);
    expect(result.latest?.measured_on).toBe("2026-06-01");
    expect(result.measurements.map((m) => m.id)).toEqual(["c", "b", "a"]);
  });
});

describe("what the forms refuse", () => {
  const base = { programId: PROGRAM, title: "Saturday club", occurredOn: "2026-03-01" };

  it("will not mark a session delivered with no attendance", () => {
    const result = recordOperationSchema.safeParse({ ...base, status: "delivered" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/How many people came/);
    }
  });

  it("will not cancel a session without a reason", () => {
    expect(
      recordOperationSchema.safeParse({ ...base, status: "cancelled" }).success,
    ).toBe(false);
  });

  it("will not leave attendance on a cancelled session", () => {
    expect(
      recordOperationSchema.safeParse({
        ...base,
        status: "cancelled",
        cancellationReason: "Snow",
        attendeeCount: 12,
      }).success,
    ).toBe(false);
  });

  it("accepts an ordinary delivered session", () => {
    expect(
      recordOperationSchema.safeParse({
        ...base,
        status: "delivered",
        attendeeCount: "24",
        durationHours: "2.5",
      }).success,
    ).toBe(true);
  });

  it("refuses a target that contradicts its direction", () => {
    const result = createMetricSchema.safeParse({
      programId: PROGRAM,
      name: "Attendance",
      unit: "people",
      direction: "increase",
      baseline: 100,
      target: 50,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/wrong way/);
    }
  });

  it("accepts a reduction target when lower is better", () => {
    expect(
      createMetricSchema.safeParse({
        programId: PROGRAM,
        name: "Waiting list",
        unit: "people",
        direction: "decrease",
        baseline: 80,
        target: 20,
      }).success,
    ).toBe(true);
  });

  it("refuses a target equal to the baseline", () => {
    expect(
      createMetricSchema.safeParse({
        programId: PROGRAM,
        name: "Attendance",
        unit: "people",
        baseline: 100,
        target: 100,
      }).success,
    ).toBe(false);
  });

  it("refuses a sample of nobody", () => {
    expect(
      recordMeasurementSchema.safeParse({
        metricId: PROGRAM,
        measuredOn: "2026-03-01",
        value: 5,
        sampleSize: 0,
      }).success,
    ).toBe(false);
  });
});

describe("the database says the same things", () => {
  const sql = migration();

  it("keeps every rule the forms mirror", () => {
    expect(sql).toContain("cancelled_operations_explain_themselves");
    expect(sql).toContain("delivered_operations_are_counted");
    expect(sql).toContain("cancelled_operations_had_no_attendance");
    expect(sql).toContain("direction_agrees_with_the_target");
    expect(sql).toContain("target_differs_from_baseline");
  });

  it("allows one reading per metric per day", () => {
    expect(sql).toContain("uq_measurement_per_day");
  });
});
