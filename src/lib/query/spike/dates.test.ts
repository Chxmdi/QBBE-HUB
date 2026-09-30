import { describe, expect, it } from "vitest";
import { isValidTimeZone, localDay, relativeRange } from "./dates";

describe("relative dates", () => {
  it("uses the viewer's time zone for today", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    expect(localDay(now, "America/Toronto")).toBe("2026-09-30");
    expect(localDay(now, "UTC")).toBe("2026-10-01");
  });

  it("starts weeks on Monday", () => {
    // 2026-09-30 is a Wednesday.
    expect(relativeRange("this_week", "2026-09-30")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(relativeRange("last_week", "2026-09-30")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    expect(relativeRange("next_week", "2026-09-30")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    // Sunday belongs to the week that started the Monday before.
    expect(relativeRange("this_week", "2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(relativeRange("this_week", "2026-09-28")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });

  it("handles month ends and leap years", () => {
    expect(relativeRange("this_month", "2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(relativeRange("this_month", "2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(relativeRange("tomorrow", "2026-12-31")).toEqual({ start: "2027-01-01", end: "2027-01-01" });
    expect(relativeRange("last_7_days", "2026-03-02")).toEqual({ start: "2026-02-24", end: "2026-03-02" });
    expect(relativeRange("next_7_days", "2026-09-30")).toEqual({ start: "2026-09-30", end: "2026-10-06" });
  });

  it("rejects unknown time zones", () => {
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus'; drop table x;--")).toBe(false);
  });
});
