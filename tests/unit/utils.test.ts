import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";
import {
  dueLabel,
  initials,
  myWorkBucket,
  slugify,
} from "@/lib/utils";

const iso = (date: Date) => format(date, "yyyy-MM-dd");

describe("myWorkBucket", () => {
  it("returns later for unscheduled work", () => {
    expect(myWorkBucket(null)).toBe("later");
  });

  it("returns overdue for past due dates", () => {
    expect(myWorkBucket(iso(addDays(new Date(), -3)))).toBe("overdue");
  });

  it("returns today for today's date", () => {
    expect(myWorkBucket(iso(new Date()))).toBe("today");
  });

  it("returns later for far-future dates", () => {
    expect(myWorkBucket(iso(addDays(new Date(), 60)))).toBe("later");
  });
});

describe("dueLabel", () => {
  it("marks overdue work with danger tone and day count", () => {
    const result = dueLabel(iso(addDays(new Date(), -2)));
    expect(result.tone).toBe("danger");
    expect(result.label).toContain("Overdue 2d");
  });

  it("marks today as due today with warning tone", () => {
    const result = dueLabel(iso(new Date()));
    expect(result.tone).toBe("warning");
    expect(result.label).toBe("Due today");
  });

  it("handles missing dates without failing", () => {
    expect(dueLabel(null)).toEqual({ label: "No due date", tone: "muted" });
  });
});

describe("slugify", () => {
  it("produces url-safe channel slugs", () => {
    expect(slugify("Fall Workshop Series!")).toBe("fall-workshop-series");
  });

  it("collapses whitespace and underscores", () => {
    expect(slugify("  program__Family  First ")).toBe("program-family-first");
  });

  it("caps length at 60 characters", () => {
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("initials", () => {
  it("takes the first two name parts", () => {
    expect(initials("Chimdindu Okelekwe")).toBe("CO");
  });

  it("handles single names", () => {
    expect(initials("Cher")).toBe("C");
  });

  it("handles empty input", () => {
    expect(initials("")).toBe("");
  });
});
