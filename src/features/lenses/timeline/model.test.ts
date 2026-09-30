import { describe, expect, it } from "vitest";
import { arrowPath, barFor, dependentsOf, planShift, timelineRange, type Edge, type TimelineBar } from "./model";

const bar = (id: string, start: string, end: string, editable = true): TimelineBar => ({ id, title: id, start, end, hasRange: start !== end, editable, done: false });

describe("timeline model", () => {
  it("draws a bar from start and due, or one day from either", () => {
    expect(barFor({ id: "a", title: "A", start: "2026-11-02", due: "2026-11-04" }, true)).toMatchObject({ start: "2026-11-02", end: "2026-11-04", hasRange: true });
    expect(barFor({ id: "a", title: "A", start: null, due: "2026-11-04" }, true)).toMatchObject({ start: "2026-11-04", end: "2026-11-04", hasRange: false });
    expect(barFor({ id: "a", title: "A", start: null, due: null }, true)).toBeNull();
  });

  it("covers every bar with some room, within limits", () => {
    const r = timelineRange([bar("a", "2026-11-02", "2026-11-04"), bar("b", "2026-12-20", "2026-12-24")], "2026-11-10");
    expect(r.from).toBe("2026-10-30");
    expect(r.to).toBe("2026-12-31");
    expect(timelineRange([], "2026-11-10").days).toBe(42);
  });

  const edges: Edge[] = [
    { blocking: "a", blocked: "b" },
    { blocking: "b", blocked: "c" },
    { blocking: "x", blocked: "c" },
  ];

  it("finds dependents through chains", () => {
    expect(dependentsOf("a", edges)).toEqual(["b", "c"]);
    expect(dependentsOf("c", edges)).toEqual([]);
  });

  it("pushes dependents only as far as they need, keeping their length", () => {
    const bars = [bar("a", "2026-11-02", "2026-11-04"), bar("b", "2026-11-05", "2026-11-06"), bar("c", "2026-11-10", "2026-11-12"), bar("x", "2026-11-01", "2026-11-02")];
    // A moves 3 days later: B must start after the 7th (+3), C after B's new end (the 9th) — it already starts on the 10th.
    const plan = planShift(bars, edges, "a", 3, 3);
    expect(plan.primary).toEqual({ id: "a", start: "2026-11-05", due: "2026-11-07" });
    expect(plan.dependents).toEqual([{ id: "b", start: "2026-11-08", due: "2026-11-09" }]);
    // 6 days: C must move too.
    expect(planShift(bars, edges, "a", 6, 6).dependents.map((m) => m.id)).toEqual(["b", "c"]);
    // Earlier never pulls anything.
    expect(planShift(bars, edges, "a", -2, -2).dependents).toEqual([]);
  });

  it("reports dependents that would need to move but cannot be edited", () => {
    const bars = [bar("a", "2026-11-02", "2026-11-04"), bar("b", "2026-11-05", "2026-11-06", false)];
    const plan = planShift(bars, edges, "a", 3, 3);
    expect(plan.dependents).toEqual([]);
    expect(plan.blockedBy).toEqual(["b"]);
  });

  it("resizing moves only the end; shrinking past the start leaves a one-day bar", () => {
    const bars = [bar("a", "2026-11-02", "2026-11-04")];
    expect(planShift(bars, [], "a", 0, 2).primary).toEqual({ id: "a", start: "2026-11-02", due: "2026-11-06" });
    expect(planShift(bars, [], "a", 0, -5).primary).toEqual({ id: "a", start: "2026-10-30", due: "2026-10-30" });
  });

  it("draws arrows from the end of one bar to the start of the next", () => {
    expect(arrowPath("2026-11-01", bar("a", "2026-11-02", "2026-11-04"), 0, bar("b", "2026-11-06", "2026-11-07"), 1)).toBe("M 112 20 H 128 V 60 H 140");
  });
});
