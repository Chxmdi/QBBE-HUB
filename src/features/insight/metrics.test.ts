import { describe, expect, it } from "vitest";
import { bucketByWeek, calendarDate, direction, mondayOf, weekStarts } from "./metrics";

// Wednesday 30 September 2026, 15:00 UTC (11:00 in Toronto).
const now = new Date("2026-09-30T15:00:00Z");

describe("weeks", () => {
  it("finds the Monday of a date", () => {
    expect(mondayOf("2026-09-30")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
  });
  it("lists the last weeks oldest first, ending this week", () => {
    expect(weekStarts(now, 3, "America/Toronto")).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });
  it("reads instants in the organization's zone", () => {
    // 02:00 UTC on Monday is still Sunday evening in Toronto.
    expect(calendarDate("2026-09-28T02:00:00Z", "America/Toronto")).toBe("2026-09-27");
    expect(calendarDate("2026-09-28", "America/Toronto")).toBe("2026-09-28");
    expect(calendarDate("nonsense")).toBeNull();
  });
});

describe("bucketByWeek", () => {
  it("counts per week, ignores values outside or missing, and can sum a weight", () => {
    const starts = weekStarts(now, 2, "America/Toronto");
    const items = [
      { at: "2026-09-22", n: 5 },
      { at: "2026-09-29T12:00:00Z", n: 2 },
      { at: "2026-09-28T02:00:00Z", n: 7 }, // Sunday the 27th locally: previous week
      { at: "2026-08-01", n: 100 },
      { at: null, n: 100 },
    ];
    expect(bucketByWeek(items, starts, (i) => i.at, "America/Toronto").map((b) => b.count)).toEqual([2, 1]);
    expect(bucketByWeek(items, starts, (i) => i.at, "America/Toronto", (i) => i.n).map((b) => b.count)).toEqual([12, 2]);
  });
});

describe("direction", () => {
  it("compares the recent half with the earlier half, with a dead band", () => {
    expect(direction([1, 1, 5, 5])).toBe("up");
    expect(direction([5, 5, 1, 1])).toBe("down");
    expect(direction([10, 10, 10, 10.5])).toBe("flat");
    expect(direction([0, 0, 0, 0])).toBe("flat");
    expect(direction([3])).toBe("flat");
  });
});
