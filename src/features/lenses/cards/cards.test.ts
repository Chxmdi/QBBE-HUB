import { describe, expect, it } from "vitest";
import { toCatalog } from "@/lib/query/catalog";
import { parseLensSpec } from "@/lib/query/run";
import { factsFor, groupByDay, recordHref, viewSpec } from "./cards";

const catalog = toCatalog({
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "title", kind: "text", propertyKind: "text", name: { en: "T", fr: "T" } },
      { key: "status", kind: "select", propertyKind: "status", name: { en: "S", fr: "S" } },
      { key: "due", kind: "date", propertyKind: "date", name: { en: "D", fr: "D" } },
      { key: "review_role", kind: "person", propertyKind: "person", name: { en: "R", fr: "R" }, filterOnly: true },
    ],
  },
});

describe("gallery and feed helpers", () => {
  it("chooses the lens's facts that can be shown, else the defaults", () => {
    expect(factsFor(catalog, "task", ["due", "review_role", "title", "nope"])).toEqual(["due"]);
    expect(factsFor(catalog, "task", undefined)).toEqual(["status", "due"]);
  });

  it("orders a feed by the most recent change and keeps the lens's conditions", () => {
    const spec = viewSpec({ type: "task", where: { and: [{ property: "status", operator: "is", value: "ready" }] } }, ["status"], "recent", 50, 50);
    expect(spec.sort).toEqual([{ property: "edited_time", direction: "desc" }]);
    expect(spec.select).toEqual(["status", "edited_time", "created_time"]);
    expect(spec.offset).toBe(50);
    expect(() => parseLensSpec(spec)).not.toThrow();
    expect(viewSpec({ type: "task" }, [], "lens", 10).sort).toEqual([{ property: "title", direction: "asc" }]);
  });

  it("groups by day in the viewer's zone", () => {
    const items = ["2026-10-02T03:30:00Z", "2026-10-01T23:00:00Z", "2026-10-01T12:00:00Z"];
    // 03:30 UTC on the 2nd is still the 1st in Toronto.
    expect(groupByDay(items, (i) => i, "America/Toronto").map((g) => [g.day, g.items.length])).toEqual([["2026-10-01", 3]]);
    expect(groupByDay(items, (i) => i, "UTC").map((g) => g.day)).toEqual(["2026-10-02", "2026-10-01"]);
  });

  it("opens records where they live", () => {
    expect(recordHref("task", "x")).toBe("/my-work?task=x");
    expect(recordHref("project", "x")).toBe("/projects/x");
  });
});
