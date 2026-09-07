import { describe, expect, it } from "vitest";
import {
  calendarDateInZone,
  instantToWallTime,
  wallTimeToInstant,
  formatInZone,
  addCalendarDays,
  startOfDayInstant,
  zonedDueInfo,
} from "@/lib/time";

/**
 * The cases that matter are the ones a naive implementation gets wrong: the
 * two hours a year when a zone's offset changes. Toronto is UTC-5 in winter
 * and UTC-4 in summer, so a conversion that samples the offset at the wrong
 * moment lands an hour out — which is exactly the kind of error that shows up
 * as one meeting in March being wrong and nobody able to reproduce it.
 */

describe("wall-clock time is read in the organization's zone", () => {
  it("reads a winter time as EST", () => {
    // 14:00 EST is 19:00 UTC.
    expect(wallTimeToInstant("2026-01-15T14:00", "America/Toronto")?.toISOString())
      .toBe("2026-01-15T19:00:00.000Z");
  });

  it("reads a summer time as EDT", () => {
    // 14:00 EDT is 18:00 UTC. Same wall time, different instant — the whole
    // point of storing an instant rather than a string.
    expect(wallTimeToInstant("2026-07-15T14:00", "America/Toronto")?.toISOString())
      .toBe("2026-07-15T18:00:00.000Z");
  });

  it("does not resolve in the runtime's zone", () => {
    // This is the bug in one line: `new Date("2026-01-15T14:00")` on a UTC
    // server yields 14:00Z. The correct answer is five hours later.
    const naive = new Date("2026-01-15T14:00Z").toISOString();
    const correct = wallTimeToInstant("2026-01-15T14:00", "America/Toronto")?.toISOString();
    expect(correct).not.toBe(naive);
  });

  it("handles a time immediately after spring forward", () => {
    // Toronto springs forward 2026-03-08 at 02:00 → 03:00. 03:30 exists and
    // is EDT, so 07:30 UTC.
    expect(wallTimeToInstant("2026-03-08T03:30", "America/Toronto")?.toISOString())
      .toBe("2026-03-08T07:30:00.000Z");
  });

  it("handles a time immediately before spring forward", () => {
    // 01:30 the same morning is still EST, so 06:30 UTC.
    expect(wallTimeToInstant("2026-03-08T01:30", "America/Toronto")?.toISOString())
      .toBe("2026-03-08T06:30:00.000Z");
  });

  it("resolves an ambiguous autumn time to one instant without throwing", () => {
    // Toronto falls back 2026-11-01 at 02:00 → 01:00, so 01:30 happens twice.
    // Either instant is defensible; silently producing an Invalid Date is not.
    const result = wallTimeToInstant("2026-11-01T01:30", "America/Toronto");
    expect(result).not.toBeNull();
    expect(Number.isNaN(result!.getTime())).toBe(false);
    expect(["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"])
      .toContain(result!.toISOString());
  });

  it("honours a different zone", () => {
    expect(wallTimeToInstant("2026-01-15T14:00", "UTC")?.toISOString())
      .toBe("2026-01-15T14:00:00.000Z");
    expect(wallTimeToInstant("2026-01-15T14:00", "Europe/Paris")?.toISOString())
      .toBe("2026-01-15T13:00:00.000Z");
  });

  it("refuses input it cannot read rather than inventing an instant", () => {
    // An Invalid Date stored as a timestamp is worse than a rejected form.
    expect(wallTimeToInstant("", "America/Toronto")).toBeNull();
    expect(wallTimeToInstant("not a date", "America/Toronto")).toBeNull();
    expect(wallTimeToInstant("2026-13-45T99:99", "America/Toronto")).toBeNull();
  });
});

describe("an instant renders back as the wall time it was typed as", () => {
  it("round-trips across both sides of a DST boundary", () => {
    for (const wall of ["2026-01-15T14:00", "2026-07-15T14:00", "2026-03-08T03:30"]) {
      const instant = wallTimeToInstant(wall, "America/Toronto");
      expect(instantToWallTime(instant!.toISOString(), "America/Toronto")).toBe(wall);
    }
  });
});

describe("display uses the organization's zone", () => {
  it("shows a winter instant as the hour it was scheduled for", () => {
    const shown = formatInZone("2026-01-15T19:00:00.000Z", "America/Toronto", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(shown).toBe("14:00");
  });

  it("returns a dash rather than throwing on a bad value", () => {
    expect(formatInZone(null)).toBe("—");
    expect(formatInZone("not a date")).toBe("—");
  });
});

describe("a date column is not an instant", () => {
  /**
   * `task.due_at` is a `date`, so "2026-09-05" is already a calendar date with
   * no zone attached. Reading it through `new Date()` gives UTC midnight,
   * which in Toronto is the evening of the 4th — every task due date a day
   * early. `meeting.starts_at` is a `timestamptz` and genuinely does need
   * converting. The two look alike in TypeScript and must not be treated alike.
   */
  it("leaves a bare calendar date exactly as written", () => {
    expect(calendarDateInZone("2026-09-05", "America/Toronto")).toBe("2026-09-05");
    expect(calendarDateInZone("2026-01-01", "Pacific/Auckland")).toBe("2026-01-01");
  });

  it("still converts a real instant", () => {
    // 00:30 UTC is the previous evening in Toronto.
    expect(calendarDateInZone("2026-09-05T00:30:00.000Z", "America/Toronto"))
      .toBe("2026-09-04");
  });

  it("does not report a date-only due date as overdue on its own day", () => {
    const info = zonedDueInfo(
      "2026-09-05",
      "America/Toronto",
      new Date("2026-09-05T02:00:00.000Z"), // 22:00 on the 4th in Toronto
    );
    // The server's UTC clock already says the 5th; Toronto does not. The due
    // date is the 5th, so from Toronto's point of view it is tomorrow.
    expect(info?.days).toBe(1);
  });
});

describe("overdue is the same answer wherever it is computed", () => {
  it("agrees between a UTC server evening and the organization's zone", () => {
    // The bug this replaces: after 19:00 in Montreal the server is on the next
    // UTC day, so a server-side grouping said "overdue" while the client-side
    // label said "due today". Pinned to one zone, one answer.
    const evening = new Date("2026-09-05T23:30:00.000Z"); // 19:30 Toronto
    expect(zonedDueInfo("2026-09-05", "America/Toronto", evening)?.days).toBe(0);
    expect(zonedDueInfo("2026-09-04", "America/Toronto", evening)?.days).toBe(-1);
  });

  it("counts the rest of a Monday-start week", () => {
    const wednesday = new Date("2026-09-02T16:00:00.000Z"); // Wed noon Toronto
    expect(zonedDueInfo("2026-09-04", "America/Toronto", wednesday)?.withinThisWeek).toBe(true);
    // Sunday closes the week; the following Monday does not belong to it.
    expect(zonedDueInfo("2026-09-06", "America/Toronto", wednesday)?.withinThisWeek).toBe(true);
    expect(zonedDueInfo("2026-09-07", "America/Toronto", wednesday)?.withinThisWeek).toBe(false);
  });
});

describe("a local day is a calendar question and an instant question at once", () => {
  /**
   * The dashboard had both halves wrong. It derived "today" as
   * `new Date().toISOString().slice(0, 10)` — the server's UTC date — and then
   * used that one string for two different jobs: comparing against `due_at`,
   * a `date` column, and bounding `starts_at`, a `timestamptz`. The first needs
   * a calendar date in the organization's zone; the second needs the instant
   * that date begins there. UTC midnight is neither.
   */
  it("adds days without letting a zone into the answer", () => {
    expect(addCalendarDays("2026-09-05", 7)).toBe("2026-09-12");
    expect(addCalendarDays("2026-09-05", 1)).toBe("2026-09-06");
    // Across Toronto's spring-forward, which a millisecond-arithmetic version
    // gets wrong: those seven days contain only 167 hours.
    expect(addCalendarDays("2026-03-05", 7)).toBe("2026-03-12");
    // And across a year boundary and a leap day.
    expect(addCalendarDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("refuses a value that is not a calendar date", () => {
    expect(addCalendarDays("2026-09-05T00:00:00Z", 1)).toBeNull();
    expect(addCalendarDays("not a date", 1)).toBeNull();
  });

  it("starts the day at local midnight, not UTC midnight", () => {
    // The bug in one line: 2026-09-05T00:00:00Z is 20:00 on the 4th in Toronto,
    // so a window opening there sweeps in the previous evening.
    const start = startOfDayInstant("2026-09-05", "America/Toronto");
    expect(start?.toISOString()).toBe("2026-09-05T04:00:00.000Z");
    expect(start?.toISOString()).not.toBe("2026-09-05T00:00:00.000Z");
  });

  it("gives a winter day the other offset", () => {
    expect(startOfDayInstant("2026-01-15", "America/Toronto")?.toISOString())
      .toBe("2026-01-15T05:00:00.000Z");
  });

  it("bounds a day that is not 24 hours long", () => {
    // Toronto springs forward on 2026-03-08: that local day is 23 hours. A
    // window built as "start + 24h" would reach into the 9th.
    const start = startOfDayInstant("2026-03-08", "America/Toronto")!;
    const end = startOfDayInstant(addCalendarDays("2026-03-08", 1)!, "America/Toronto")!;
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);

    // And the November day that is 25 hours long.
    const fallStart = startOfDayInstant("2026-11-01", "America/Toronto")!;
    const fallEnd = startOfDayInstant(addCalendarDays("2026-11-01", 1)!, "America/Toronto")!;
    expect((fallEnd.getTime() - fallStart.getTime()) / 3_600_000).toBe(25);
  });

  it("puts an evening meeting inside today rather than tomorrow", () => {
    // 23:30 Toronto on 5 September is 03:30 UTC on the 6th. The old lower bound
    // (`2026-09-05T00:00:00Z`) plus a rolling `now + 24h` upper bound made the
    // window span up to 48 hours; a real day window contains this and excludes
    // the same clock time a day later.
    const start = startOfDayInstant("2026-09-05", "America/Toronto")!;
    const end = startOfDayInstant("2026-09-06", "America/Toronto")!;
    const tonight = new Date("2026-09-06T03:30:00.000Z");
    const tomorrowNight = new Date("2026-09-07T03:30:00.000Z");
    expect(tonight >= start && tonight < end).toBe(true);
    expect(tomorrowNight >= start && tomorrowNight < end).toBe(false);
  });
});
