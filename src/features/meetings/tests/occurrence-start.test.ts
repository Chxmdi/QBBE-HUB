import { describe, expect, it } from "vitest";
import { occurrenceStart } from "@/features/meetings/occurrence";

const wall = (date: Date) => date.toISOString().slice(0, 16);

describe("occurrenceStart", () => {
  it("puts a month-end meeting on the last day of each month, once a month", () => {
    const first = new Date("2026-01-31T10:00Z");
    const starts = [1, 2, 3, 4, 5].map((index) => wall(occurrenceStart(first, "monthly", index)));
    expect(starts).toEqual([
      "2026-02-28T10:00",
      "2026-03-31T10:00",
      "2026-04-30T10:00",
      "2026-05-31T10:00",
      "2026-06-30T10:00",
    ]);
  });

  it("keeps ordinary monthly, weekly and fortnightly spacing", () => {
    const first = new Date("2026-01-15T18:30Z");
    expect(wall(occurrenceStart(first, "monthly", 1))).toBe("2026-02-15T18:30");
    expect(wall(occurrenceStart(first, "weekly", 2))).toBe("2026-01-29T18:30");
    expect(wall(occurrenceStart(first, "fortnightly", 3))).toBe("2026-02-26T18:30");
    expect(wall(occurrenceStart(first, "monthly", 12))).toBe("2027-01-15T18:30");
  });
});
