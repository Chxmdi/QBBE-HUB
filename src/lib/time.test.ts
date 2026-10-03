import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, formatInZone, isRealTimeZone, viewerTimeZone } from "@/lib/time";
import { dueLabel, formatDate } from "@/lib/utils";

/** A `date` column's value is a calendar day, not UTC midnight shifted west. */
describe("formatInZone with a bare calendar date", () => {
  it("shows the day as written, in any zone", () => {
    expect(formatInZone("2026-10-20", "America/Toronto", { month: "short", day: "numeric", year: "numeric" }, "en")).toBe(
      "Oct 20, 2026",
    );
    expect(formatInZone("2026-10-20", "America/Toronto", { month: "short", day: "numeric", year: "numeric" }, "fr-CA")).toBe(
      "20 oct. 2026",
    );
    // The first of a month is the case a day's shift would make most visible.
    expect(formatInZone("2026-11-01", "America/Toronto", { month: "short", day: "numeric" }, "en")).toBe("Nov 1");
    expect(formatDate("2026-10-20", "America/Toronto", "en")).toBe("Oct 20, 2026");
  });

  it("still converts a genuine instant into the zone", () => {
    expect(formatInZone("2026-10-20T02:30:00Z", "America/Toronto", { month: "short", day: "numeric" }, "en")).toBe("Oct 19");
  });

  it("labels a far due date with its own day", () => {
    const farDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(Date.now() + 20 * 86_400_000));
    const [year, month, day] = farDay.split("-").map(Number);
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" }).format(
      new Date(Date.UTC(year, month - 1, day)),
    );
    expect(dueLabel(farDay, "America/Toronto", "en").label).toBe(expected);
  });
});

describe("time zones a person can save", () => {
  it("knows real zones from made-up ones", () => {
    for (const zone of ["America/Toronto", "Europe/Paris", "UTC", "Asia/Kolkata"]) {
      expect(isRealTimeZone(zone), zone).toBe(true);
    }
    for (const zone of ["Mars/Olympus", "America/Montreal'; drop table x;--", "", "GMT+25"]) {
      expect(isRealTimeZone(zone), zone).toBe(false);
    }
  });

  it("shows a stored zone only when it is real, and the workspace default otherwise", () => {
    expect(viewerTimeZone("Europe/Paris")).toBe("Europe/Paris");
    expect(viewerTimeZone("Mars/Olympus")).toBe(DEFAULT_TIME_ZONE);
    expect(viewerTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(viewerTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(viewerTimeZone("")).toBe(DEFAULT_TIME_ZONE);
  });
});
