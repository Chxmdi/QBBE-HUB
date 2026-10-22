import { describe, expect, it } from "vitest";
import {
  anchorDay,
  calendarWindow,
  dayAsLocalDate,
  timeOfDayLabel,
  timedItemDay,
  windowInstants,
} from "@/features/calendar/calendar-model";

const TORONTO = "America/Toronto";

/**
 * The server runs in UTC (no TZ in the image), so the calendar must place
 * timed records by the workspace's zone, never the process's. These tests are
 * meant to pass with TZ=UTC as well as in any other zone.
 */
describe("calendar model", () => {
  it("puts an evening meeting on its Toronto day, not the next UTC day", () => {
    // 2026-10-24 01:00Z is Friday 23 October, 21:00 in Toronto.
    expect(timedItemDay("2026-10-24T01:00:00Z", TORONTO)).toBe("2026-10-23");
    expect(timeOfDayLabel("2026-10-24T01:00:00Z", TORONTO, "en")).toBe("9:00 p.m.");
    expect(timeOfDayLabel("2026-10-24T01:00:00Z", TORONTO, "fr-CA")).toBe("21 h 00");
  });

  it("asks the database for the instants that bound the window in the zone", () => {
    const week = calendarWindow("week", "2026-10-22");
    expect(week.from).toBe("2026-10-18");
    expect(week.to).toBe("2026-10-24");
    expect(week.days).toHaveLength(7);
    const bounds = windowInstants(week, TORONTO);
    // Sunday 18 Oct 00:00 EDT, and the instant Sunday 25 Oct begins.
    expect(bounds.startIso).toBe("2026-10-18T04:00:00.000Z");
    expect(bounds.endIso).toBe("2026-10-25T04:00:00.000Z");
  });

  it("handles the week that leaves daylight time (1 November 2026)", () => {
    const week = calendarWindow("week", "2026-11-03");
    expect(week.from).toBe("2026-11-01");
    const bounds = windowInstants(week, TORONTO);
    expect(bounds.startIso).toBe("2026-11-01T04:00:00.000Z");
    expect(bounds.endIso).toBe("2026-11-08T05:00:00.000Z");
    // 23:30 EST on Saturday 7 November is 04:30Z on the 8th.
    expect(timedItemDay("2026-11-08T04:30:00Z", TORONTO)).toBe("2026-11-07");
    expect(timeOfDayLabel("2026-11-08T04:30:00Z", TORONTO, "en")).toBe("11:30 p.m.");
  });

  it("covers whole weeks for a month", () => {
    const month = calendarWindow("month", "2026-10-15");
    expect(month.from).toBe("2026-09-27");
    expect(month.to).toBe("2026-10-31");
    expect(month.days).toHaveLength(35);
  });

  it("takes today from the zone, so the evening does not jump to tomorrow", () => {
    // 2026-10-23 01:30Z is still the evening of the 22nd in Toronto.
    const evening = new Date("2026-10-23T01:30:00Z");
    expect(anchorDay(undefined, TORONTO, evening)).toBe("2026-10-22");
    expect(anchorDay("2026-02-30", TORONTO, evening)).toBe("2026-10-22");
    expect(anchorDay("2026-03-05", TORONTO, evening)).toBe("2026-03-05");
  });

  it("turns a calendar day into a Date that formats back as that day", () => {
    const d = dayAsLocalDate("2026-10-23");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 23]);
  });
});
