import { describe, expect, it } from "vitest";
import { planTemplateItems, type TemplateItem } from "@/features/programs/template-plan";

const item = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  kind: "milestone",
  name: "Kickoff",
  description: null,
  day_offset: 0,
  sort_key: 0,
  ...over,
});

describe("planTemplateItems", () => {
  it("turns a day offset into a calendar date from the start date", () => {
    const [planned] = planTemplateItems([item({ day_offset: 14 })], "2026-09-18");
    expect(planned.dueDate).toBe("2026-10-02");
  });

  it("keeps a bare start date on its own day rather than shifting it a zone", () => {
    // task.due_at and milestone.due_date are `date` columns. Reading the start
    // through new Date() would treat it as UTC midnight, which is the previous
    // evening in Toronto, and every dated item would land a day early.
    const [planned] = planTemplateItems([item({ day_offset: 0 })], "2026-09-18");
    expect(planned.dueDate).toBe("2026-09-18");
  });

  it("crosses a month and a year boundary correctly", () => {
    expect(planTemplateItems([item({ day_offset: 20 })], "2026-12-18")[0].dueDate)
      .toBe("2027-01-07");
  });

  it("crosses a leap day", () => {
    expect(planTemplateItems([item({ day_offset: 1 })], "2028-02-28")[0].dueDate)
      .toBe("2028-02-29");
  });

  it("leaves an item with no offset undated rather than dating it today", () => {
    expect(planTemplateItems([item({ day_offset: null })], "2026-09-18")[0].dueDate)
      .toBeNull();
  });

  it("orders by sort key, then by name so the order is never arbitrary", () => {
    const planned = planTemplateItems(
      [
        item({ name: "Third", sort_key: 2 }),
        item({ name: "Beta", sort_key: 1 }),
        item({ name: "Alpha", sort_key: 1 }),
      ],
      "2026-09-18",
    );
    expect(planned.map((p) => p.name)).toEqual(["Alpha", "Beta", "Third"]);
  });

  it("does not reorder the caller's array", () => {
    const items = [item({ name: "B", sort_key: 2 }), item({ name: "A", sort_key: 1 })];
    planTemplateItems(items, "2026-09-18");
    expect(items.map((i) => i.name)).toEqual(["B", "A"]);
  });
});
