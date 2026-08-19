import { describe, expect, it } from "vitest";
import { describeSchedule, nextRun, parseCron } from "@/features/jobs/services/cron";

/**
 * Admin → Jobs shows a next-run time, and an operator will trust it. These
 * tests pin the expressions the registry actually schedules, plus the two
 * cases that catch naive implementations: step values and the day-field OR.
 */

const at = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("rejects anything that is not five fields", () => {
    expect(parseCron("* * * *")).toBeNull();
    expect(parseCron("* * * * * *")).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parseCron("60 * * * *")).toBeNull();
    expect(parseCron("* 24 * * *")).toBeNull();
  });

  it("rejects a backwards range", () => {
    expect(parseCron("* * * * 5-1")).toBeNull();
  });

  it("expands a step value", () => {
    const parsed = parseCron("*/15 * * * *");
    expect([...parsed!.minute]).toEqual([0, 15, 30, 45]);
  });

  it("expands a list", () => {
    const parsed = parseCron("0 6,18 * * *");
    expect([...parsed!.hour].sort((a, b) => a - b)).toEqual([6, 18]);
  });
});

describe("nextRun", () => {
  it("advances a minutely job to the next minute", () => {
    expect(nextRun("* * * * *", at("2026-08-19T10:30:15Z"))?.toISOString()).toBe(
      "2026-08-19T10:31:00.000Z",
    );
  });

  it("finds the next quarter hour", () => {
    expect(nextRun("*/15 * * * *", at("2026-08-19T10:31:00Z"))?.toISOString()).toBe(
      "2026-08-19T10:45:00.000Z",
    );
  });

  it("rolls a daily job to tomorrow once today's slot has passed", () => {
    expect(nextRun("0 12 * * *", at("2026-08-19T13:00:00Z"))?.toISOString()).toBe(
      "2026-08-20T12:00:00.000Z",
    );
  });

  it("finds the next Monday for a weekly job", () => {
    // 2026-08-19 is a Wednesday.
    const next = nextRun("0 10 * * 1", at("2026-08-19T13:00:00Z"))!;
    expect(next.toISOString()).toBe("2026-08-24T10:00:00.000Z");
    expect(next.getUTCDay()).toBe(1);
  });

  it("skips the weekend for a weekday job", () => {
    // 2026-08-21 is a Friday; the next run is Monday.
    const next = nextRun("0 11 * * 1-5", at("2026-08-21T13:00:00Z"))!;
    expect(next.toISOString()).toBe("2026-08-24T11:00:00.000Z");
  });

  it("treats restricted day-of-month and day-of-week as an OR, per cron", () => {
    // The 1st of the month, or any Monday, whichever comes first.
    const next = nextRun("0 0 1 * 1", at("2026-08-19T00:00:00Z"))!;
    // 2026-08-24 is the first Monday after the 19th; the 1st is further away.
    expect(next.toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });

  it("returns null for an expression it cannot parse", () => {
    expect(nextRun("not a cron", at("2026-08-19T00:00:00Z"))).toBeNull();
  });
});

describe("describeSchedule", () => {
  it("describes the registry's expressions in plain words", () => {
    expect(describeSchedule("* * * * *")).toBe("Every minute");
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("0 * * * *")).toBe("Hourly");
    expect(describeSchedule("0 12 * * *")).toBe("Daily at 12:00 UTC");
    expect(describeSchedule("0 10 * * 1")).toBe("Monday at 10:00 UTC");
    expect(describeSchedule("0 11 * * 1-5")).toBe("Weekdays at 11:00 UTC");
  });

  it("returns the raw expression rather than guessing", () => {
    expect(describeSchedule("nonsense")).toBe("nonsense");
  });
});
