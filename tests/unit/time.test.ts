import { describe, expect, it } from "vitest";
import {
  calendarDateInZone,
  instantToWallTime,
  wallTimeToInstant,
  formatInZone,
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
