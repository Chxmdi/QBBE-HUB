import { describe, expect, it } from "vitest";
import { toCatalog } from "@/lib/query/catalog";
import { parseLensSpec } from "@/lib/query/run";
import { applyDashboardFilters } from "./filters";
import { filtersFromParams, parseDashboardLayout } from "./schema";

const catalog = toCatalog({
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "program", kind: "select", propertyKind: "relation", name: { en: "P", fr: "P" }, ref: { table: "program", label: "name" } },
      { key: "assignee", kind: "person", propertyKind: "person", name: { en: "A", fr: "A" } },
      { key: "due", kind: "date", propertyKind: "date", name: { en: "D", fr: "D" } },
    ],
  },
  project: { key: "project", name: { en: "Project", fr: "Projet" }, properties: [{ key: "owner", kind: "person", propertyKind: "person", name: { en: "O", fr: "O" } }] },
});
const program = "11111111-1111-4111-8111-111111111111";

describe("dashboard layout", () => {
  it("keeps valid tiles with defaults and refuses anything else as a whole", () => {
    const layout = parseDashboardLayout({
      tiles: [
        { id: "t1", kind: "metric", source: { spec: { version: 1, type: "task" } } },
        { id: "t2", kind: "text", body: "Hello", width: 3 },
        { id: "t3", kind: "goal", source: { lensId: program }, target: 10 },
      ],
    });
    expect(layout.tiles.map((t) => t.kind)).toEqual(["metric", "text", "goal"]);
    expect(layout.tiles[0]).toMatchObject({ title: "", width: 1, measure: { kind: "count" } });
    expect(parseDashboardLayout({ tiles: [{ id: "t1", kind: "iframe", url: "https://evil.example" }] })).toEqual({ tiles: [], filters: {} });
    expect(parseDashboardLayout({ tiles: [{ id: "t1", kind: "embed", lensId: "x" }] }).tiles).toEqual([]);
    expect(parseDashboardLayout(null)).toEqual({ tiles: [], filters: {} });
  });

  it("reads filters from the URL over the saved ones", () => {
    expect(filtersFromParams({ program, mine: "1", dates: "this_week" }, {})).toEqual({ program, mine: true, dates: "this_week" });
    expect(filtersFromParams({ mine: "0", dates: "forever", program: "x" }, { mine: true, dates: "today", program })).toEqual({});
    expect(filtersFromParams({}, { dates: "today" })).toEqual({ dates: "today" });
  });
});

describe("dashboard filters", () => {
  it("add conditions only where the type has the property", () => {
    const task = applyDashboardFilters({ version: 1, type: "task", where: { and: [{ property: "status", operator: "is", value: "ready" }] } }, { program, mine: true, dates: "this_week" }, catalog);
    expect(task.where).toEqual({
      and: [
        { property: "status", operator: "is", value: "ready" },
        { property: "program", operator: "is", value: program },
        { property: "assignee", operator: "contains", value: { relative: "me" } },
        { property: "due", operator: "is", value: { relative: "this_week" } },
      ],
    });
    expect(() => parseLensSpec(task)).not.toThrow();
    const project = applyDashboardFilters({ version: 1, type: "project" }, { program, mine: true, dates: "today" }, catalog);
    expect(project.where).toEqual({ and: [{ property: "owner", operator: "contains", value: { relative: "me" } }] });
    expect(applyDashboardFilters({ version: 1, type: "task" }, {}, catalog).where).toBeUndefined();
  });
});
