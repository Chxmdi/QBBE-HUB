import { describe, expect, it } from "vitest";
import { parseLensSpec, type LensRow } from "@/lib/query/run";
import { calendarRange, calendarSpec, isIsoDay, monthDays, rowsToItems, shiftAnchor } from "./model";

describe("calendar lens model", () => {
  it("covers whole weeks for a month, Sunday first", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(calendarRange("month", "2026-10-15")).toEqual({ from: "2026-09-27", to: "2026-10-31" });
    expect(monthDays("2026-10-15")).toHaveLength(35);
    expect(calendarRange("week", "2026-10-15")).toEqual({ from: "2026-10-11", to: "2026-10-17" });
    expect(calendarRange("agenda", "2026-10-15")).toEqual({ from: "2026-10-15", to: "2026-11-13" });
  });

  it("moves between windows", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftAnchor("week", "2026-10-15", -1)).toBe("2026-10-08");
  });

  it("validates days", () => {
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("tomorrow")).toBe(false);
  });

  it("narrows the lens to the window, keeping its own conditions, as a valid spec", () => {
    const spec = calendarSpec(
      { version: 1, type: "task", where: { and: [{ property: "priority", operator: "is", value: "high" }] } },
      "due",
      { from: "2026-09-27", to: "2026-10-31" },
    );
    expect(spec.where).toEqual({
      and: [
        { property: "priority", operator: "is", value: "high" },
        { property: "due", operator: "between", value: { from: { date: "2026-09-27" }, to: { date: "2026-10-31" } } },
      ],
    });
    expect(spec.select).toEqual(["due", "status", "assignee"]);
    expect(() => parseLensSpec(spec)).not.toThrow();
  });

  it("turns rows into items, offering a move only where it will work", () => {
    const rows: LensRow[] = [
      { id: "a", title: "A", group: null, values: { due: "2026-10-02", status: "completed", assignee: { id: "u", label: "Ada" } } },
      { id: "b", title: "B", group: null, values: { due: "2026-10-03", status: "ready", assignee: null } },
      { id: "c", title: "C", group: null, values: { due: null } },
    ];
    const items = rowsToItems(rows, "task", "due", new Set(["b"]));
    expect(items.map((i) => [i.recordId, i.day, i.done, i.owner, i.reschedulableDate])).toEqual([
      ["a", "2026-10-02", true, "Ada", null],
      ["b", "2026-10-03", false, null, "2026-10-03"],
    ]);
    expect(rowsToItems(rows, "task", "start", new Set(["b"])).every((i) => i.reschedulableDate === null)).toBe(true);
  });
});
