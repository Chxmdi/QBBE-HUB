import { describe, expect, it } from "vitest";
import type { CatalogType } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { lensSpecSchema } from "@/lib/query/spec";
import {
  buildDisplayRows,
  defaultColumns,
  ensureInWindow,
  MAX_WIDTH,
  MIN_WIDTH,
  moveColumn,
  moveFocus,
  numberTotals,
  rawText,
  reconcileColumns,
  resizeColumn,
  setHidden,
  specFor,
  stateFromLens,
  virtualWindow,
  visibleColumns,
  ROW_HEIGHT,
} from "./model";

const type: CatalogType = {
  key: "task",
  name: { en: "Task", fr: "Tâche" },
  properties: [
    { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true, groupable: false },
    {
      key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, sortable: true, groupable: true,
      choices: [{ key: "ready", label: { en: "Ready", fr: "Prête" } }],
    },
    { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate", fr: "Estimation" }, sortable: true, groupable: false },
    { key: "assignee", kind: "person", propertyKind: "person", name: { en: "Assignee", fr: "Responsable" }, sortable: false, groupable: true },
    { key: "review_role", kind: "person", propertyKind: "person", name: { en: "Role", fr: "Rôle" }, sortable: false, groupable: false, filterOnly: true },
  ],
};

const row = (id: string, group: string | null, values: LensRow["values"] = {}): LensRow => ({ id, title: id, group, values });

describe("columns", () => {
  it("starts with every property, title first and wider", () => {
    const cols = defaultColumns(type);
    expect(cols.map((c) => c.key)).toEqual(["title", "status", "estimate", "assignee"]);
    expect(cols[0].width).toBeGreaterThan(cols[1].width);
  });

  it("resizes within bounds", () => {
    const cols = defaultColumns(type);
    expect(resizeColumn(cols, "status", 5).find((c) => c.key === "status")!.width).toBe(MIN_WIDTH);
    expect(resizeColumn(cols, "status", 5000).find((c) => c.key === "status")!.width).toBe(MAX_WIDTH);
  });

  it("moves among visible columns and never past the title", () => {
    let cols = defaultColumns(type);
    cols = moveColumn(cols, "estimate", -1);
    expect(cols.map((c) => c.key)).toEqual(["title", "estimate", "status", "assignee"]);
    expect(moveColumn(cols, "estimate", -1)).toEqual(cols);
    expect(moveColumn(cols, "title", 1)).toEqual(cols);
    cols = setHidden(cols, "status", true);
    cols = moveColumn(cols, "estimate", 1);
    expect(visibleColumns(cols).map((c) => c.key)).toEqual(["title", "assignee", "estimate"]);
  });

  it("never hides the title", () => {
    expect(visibleColumns(setHidden(defaultColumns(type), "title", true))[0].key).toBe("title");
  });

  it("reconciles a saved layout with the catalog", () => {
    const cols = reconcileColumns(type, [
      { key: "estimate", width: 9999, hidden: false },
      { key: "gone", width: 100, hidden: false },
      { key: "title", width: 200, hidden: true },
      { key: "estimate", width: 100, hidden: true },
    ]);
    expect(cols.map((c) => c.key)).toEqual(["estimate", "title", "status", "assignee"]);
    expect(cols[0].width).toBe(MAX_WIDTH);
    expect(cols[1].hidden).toBe(false);
    expect(reconcileColumns(type, null)).toEqual(defaultColumns(type));
  });
});

describe("specFor", () => {
  it("asks for the visible columns, search, sort and grouping, and is a valid spec", () => {
    const spec = specFor(
      "task",
      {
        columns: setHidden(defaultColumns(type), "assignee", true),
        sort: { property: "estimate", direction: "desc" },
        groupBy: "status",
        search: "  grant ",
      },
      1000,
    );
    expect(spec).toEqual({
      version: 1,
      type: "task",
      where: { and: [{ property: "title", operator: "contains", value: "grant" }] },
      sort: [{ property: "estimate", direction: "desc" }],
      groupBy: { property: "status" },
      select: ["status", "estimate"],
      limit: 1000,
      offset: 1000,
    });
    expect(lensSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("display rows", () => {
  const rows = [row("a", "ready"), row("b", "ready"), row("c", null)];
  const groups = [
    { key: "ready", label: null, total: 2 },
    { key: null, label: null, total: 1 },
  ];

  it("puts a header before each group", () => {
    const out = buildDisplayRows(rows, groups, (g) => g.key ?? "none", new Set());
    expect(out.map((r) => (r.kind === "group" ? `[${r.label} ${r.count}]` : r.row.id))).toEqual([
      "[ready 2]", "a", "b", "[none 1]", "c",
    ]);
  });

  it("hides a collapsed group's rows", () => {
    const out = buildDisplayRows(rows, groups, (g) => g.key ?? "none", new Set(["ready"]));
    expect(out.map((r) => (r.kind === "group" ? `[${r.label}]` : r.row.id))).toEqual(["[ready]", "[none]", "c"]);
  });

  it("is plain rows without grouping", () => {
    expect(buildDisplayRows(rows, null, () => "", new Set())).toHaveLength(3);
  });
});

describe("totals", () => {
  it("sums number columns, ignoring empty values", () => {
    const totals = numberTotals(
      [row("a", null, { estimate: 1.25 }), row("b", null, { estimate: null }), row("c", null, { estimate: "2.5" })],
      type.properties,
    );
    expect(totals).toEqual({ estimate: 3.75 });
  });
});

describe("keyboard", () => {
  const size = { rows: 11, cols: 4, pageRows: 5 };
  it("moves by arrows and stops at the edges", () => {
    expect(moveFocus({ row: 0, col: 0 }, "ArrowUp", { ctrl: false }, size)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 0, col: 0 }, "ArrowDown", { ctrl: false }, size)).toEqual({ row: 1, col: 0 });
    expect(moveFocus({ row: 3, col: 3 }, "ArrowRight", { ctrl: false }, size)).toEqual({ row: 3, col: 3 });
  });
  it("supports Home, End, Ctrl+Home, Ctrl+End and paging", () => {
    expect(moveFocus({ row: 3, col: 2 }, "Home", { ctrl: false }, size)).toEqual({ row: 3, col: 0 });
    expect(moveFocus({ row: 3, col: 2 }, "End", { ctrl: false }, size)).toEqual({ row: 3, col: 3 });
    expect(moveFocus({ row: 3, col: 2 }, "Home", { ctrl: true }, size)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 3, col: 2 }, "End", { ctrl: true }, size)).toEqual({ row: 10, col: 3 });
    expect(moveFocus({ row: 3, col: 2 }, "PageDown", { ctrl: false }, size)).toEqual({ row: 8, col: 2 });
    expect(moveFocus({ row: 3, col: 2 }, "PageUp", { ctrl: false }, size)).toEqual({ row: 0, col: 2 });
    expect(moveFocus({ row: 3, col: 2 }, "a", { ctrl: false }, size)).toBeNull();
  });
});

describe("virtual window", () => {
  it("renders the visible rows plus overscan", () => {
    expect(virtualWindow(0, ROW_HEIGHT * 10, 5000, 5)).toEqual({ start: 0, end: 15 });
    expect(virtualWindow(ROW_HEIGHT * 100, ROW_HEIGHT * 10, 5000, 5)).toEqual({ start: 95, end: 115 });
    expect(virtualWindow(ROW_HEIGHT * 5000, ROW_HEIGHT * 10, 5000, 5).end).toBe(5000);
  });
  it("moves the window to a focused row outside it", () => {
    expect(ensureInWindow(500, { start: 0, end: 40 }, 5000)).toEqual({ start: 490, end: 530 });
    expect(ensureInWindow(20, { start: 0, end: 40 }, 5000)).toEqual({ start: 0, end: 40 });
  });
});

describe("cell text", () => {
  it("labels options in the viewer's language and references by label", () => {
    expect(rawText(type.properties[1], "ready", "fr-CA")).toBe("Prête");
    expect(rawText(type.properties[3], { id: "u", label: "Ada" }, "en")).toBe("Ada");
    expect(rawText(type.properties[2], null, "en")).toBeNull();
  });
});

describe("saved lenses", () => {
  it("open with their columns, sort, grouping and conditions, and save back the same spec", () => {
    const condition = { property: "status", operator: "is", value: "ready" } as const;
    const state = stateFromLens(
      type,
      { version: 1, type: "task", where: { and: [condition] }, sort: [{ property: "estimate", direction: "desc" }], groupBy: { property: "status" } },
      { columns: [{ key: "estimate", width: 200, hidden: false }] },
    );
    expect(state.sort).toEqual({ property: "estimate", direction: "desc" });
    expect(state.groupBy).toBe("status");
    expect(state.columns[0]).toEqual({ key: "estimate", width: 200, hidden: false });
    const spec = specFor("task", { ...state, search: "x" });
    expect(spec.where).toEqual({ and: [condition, { property: "title", operator: "contains", value: "x" }] });
  });

  it("drops what the table cannot show", () => {
    const state = stateFromLens(type, { sort: [{ property: "assignee" }], groupBy: { property: "title" } }, {});
    expect(state.sort).toBeNull();
    expect(state.groupBy).toBeNull();
    expect(state.filters).toEqual([]);
  });
});
