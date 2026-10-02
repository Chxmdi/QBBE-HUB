import { describe, expect, it, vi } from "vitest";
import type { CatalogProperty } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { createLensT } from "@/features/lenses/i18n";
import { cellEditorFor, type EditorKind } from "../editable";
import { moveFocus, type DisplayRow } from "../model";

vi.mock("@/features/lenses/services/lens.actions", () => ({ pasteLensCells: vi.fn(), undoLensCells: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: vi.fn() }));

const { copyMatrix, copyText, parseTsv, pasteMessage, planPaste, rangeOf, tabTarget, toTsv } = await import("./d1-grid");

const PERSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const prop = (key: string, kind: CatalogProperty["kind"], extra: Partial<CatalogProperty> = {}) =>
  ({ key, kind, propertyKind: kind, name: { en: key, fr: key }, sortable: true, groupable: false, ...extra }) as CatalogProperty;
const properties = new Map<string, CatalogProperty>([
  ["title", prop("title", "text")],
  ["priority", prop("priority", "select", { choices: [{ key: "high", label: { en: "High", fr: "Haute" } }, { key: "low", label: { en: "Low", fr: "Basse" } }] })],
  ["estimate", prop("estimate", "number")],
  ["due", prop("due", "date")],
  ["assignee", prop("assignee", "person")],
  ["created_time", prop("created_time", "date", { timestamp: true })],
]);
const shown = [...properties.keys()].map((key) => ({ key, width: 120, hidden: false }));
const row = (id: string, values: LensRow["values"] = {}): LensRow => ({ id, title: `Task ${id}`, group: null, values });
const rows = [
  row("a", { priority: "high", estimate: 2.5, due: "2026-03-31T00:00:00+00:00", assignee: { id: PERSON, label: "Quinn Owner" } }),
  row("b", { priority: "low", estimate: null, due: null, assignee: null }),
  row("c"),
];
const display: DisplayRow[] = [{ kind: "group", key: "x", label: "Group", count: 3, collapsed: false }, ...rows.map((r) => ({ kind: "record" as const, row: r }))];
// Row "b" is read-only for this viewer.
const editorFor = (r: LensRow, key: string): EditorKind | null => (r.id === "b" ? null : cellEditorFor("task", key));
const t = createLensT("en");

describe("D1-3: copy a range as tab-separated text", () => {
  it("copies what a person would type back, row by row, without group rows", () => {
    const matrix = copyMatrix(rangeOf({ row: 1, col: 0 }, { row: 3, col: 4 }), display, shown, properties, "en");
    expect(matrix).toEqual([
      ["Task a", "High", "2.5", "2026-03-31", "Quinn Owner"],
      ["Task b", "Low", "", "", ""],
    ]);
    expect(toTsv(matrix)).toBe("Task a\tHigh\t2.5\t2026-03-31\tQuinn Owner\nTask b\tLow\t\t\t");
    expect(copyText(properties.get("priority")!, "high", "fr-CA")).toBe("Haute");
    expect(copyText(prop("done", "checkbox"), true, "en")).toBe("TRUE");
  });

  it("round-trips tabs, line breaks and quotes", () => {
    const matrix = [["a\tb", 'say "hi"'], ["two\nlines", ""]];
    expect(parseTsv(toTsv(matrix))).toEqual(matrix);
    expect(parseTsv("1\t2\r\n3\t4\r\n")).toEqual([["1", "2"], ["3", "4"]]);
    // A lone leading quote is text, not the start of a quoted cell.
    expect(parseTsv('"Phase 2 kickoff\tHigh\nNext\tLow')).toEqual([['"Phase 2 kickoff', "High"], ["Next", "Low"]]);
  });

  it("orders a range whichever way it was drawn", () => {
    expect(rangeOf({ row: 4, col: 3 }, { row: 2, col: 1 })).toEqual({ top: 2, bottom: 4, left: 1, right: 3 });
    expect(rangeOf(null, { row: 2, col: 1 })).toEqual({ top: 2, bottom: 2, left: 1, right: 1 });
  });
});

describe("D1-3 and D1-5: a paste fills only what the person can edit, with values that fit", () => {
  const options = (key: string) => (key === "assignee" ? [{ id: PERSON, label: "Quinn Owner" }] : undefined);

  it("writes editable cells, skips read-only rows and computed columns, and counts both", () => {
    const plan = planPaste({
      matrix: parseTsv("Low\t4\t2026-04-01\tquinn owner\t2026-01-01\nHigh\t5\t2026-04-02\t\t2026-01-01\nHigh\t6\t\t\t"),
      range: rangeOf(null, { row: 2, col: 1 }),
      display,
      shown,
      properties,
      editorFor,
      options,
      locale: "en",
    });
    expect(plan.cells.map((c) => [c.row.id, c.key, c.raw])).toEqual([
      ["a", "priority", "low"],
      ["a", "estimate", "4"],
      ["a", "due", "2026-04-01"],
      ["a", "assignee", PERSON],
      ["c", "priority", "high"],
      ["c", "estimate", "6"],
      ["c", "due", null],
      ["c", "assignee", null],
    ]);
    // Row b's five cells, and created_time on rows a and c.
    expect(plan.readOnly).toBe(5 + 2);
    expect(plan.invalid).toBe(0);
  });

  it("reads pasted numbers in the person's language", () => {
    const at = (locale: string, text: string) =>
      planPaste({ matrix: [[text]], range: rangeOf(null, { row: 2, col: 2 }), display, shown, properties, editorFor, options, locale }).cells[0]?.raw ?? null;
    expect(at("en", "1,500")).toBe("1500");
    expect(at("en", "2,5")).toBeNull();
    expect(at("fr-CA", "2,5")).toBe("2.5");
  });

  it("refuses values that do not fit and saves nothing for them", () => {
    const plan = planPaste({
      matrix: [["Someday", "lots", "2026-02-30"]],
      range: rangeOf(null, { row: 2, col: 1 }),
      display,
      shown,
      properties,
      editorFor,
      options,
      locale: "en",
    });
    expect(plan.cells).toEqual([]);
    expect(plan.invalid).toBe(3);
  });

  it("fills a whole selection from one copied value, and stops at the table's edge", () => {
    const fill = planPaste({ matrix: [["3"]], range: rangeOf({ row: 2, col: 2 }, { row: 4, col: 2 }), display, shown, properties, editorFor, options, locale: "en" });
    expect(fill.cells.map((c) => [c.row.id, c.raw])).toEqual([["a", "3"], ["c", "3"]]);
    expect(fill.readOnly).toBe(1);
    const edge = planPaste({ matrix: [["1", "2", "3"], ["4", "5", "6"]], range: rangeOf(null, { row: 4, col: 4 }), display, shown, properties, editorFor, options, locale: "en" });
    // Only "1" lands in assignee (not a person: invalid) and "2" in created_time (read-only); the rest is past the edge.
    expect(edge.cells).toEqual([]);
    expect(edge.invalid + edge.readOnly).toBe(2);
  });

  it("says how many were pasted and skipped", () => {
    expect(pasteMessage(t, { saved: 8, readOnly: 7, invalid: 0, failed: 0 })).toBe("Pasted 8 cells. Skipped 7 you cannot edit.");
    expect(pasteMessage(t, { saved: 1, readOnly: 0, invalid: 2, failed: 1 })).toBe(
      "Pasted 1 cell. Skipped 2 with values that do not fit. 1 could not be saved.",
    );
    expect(pasteMessage(createLensT("fr-CA"), { saved: 2, readOnly: 1, invalid: 0, failed: 0 })).toBe(
      "2 cellules collées. 1 ignorées parce que vous ne pouvez pas les modifier.",
    );
  });
});

describe("D1-2: moving like a spreadsheet", () => {
  const size = { rows: 1 + display.length, cols: shown.length, pageRows: 2 };

  it("Tab and Shift+Tab move along the row and leave the grid at its ends", () => {
    expect(tabTarget({ row: 2, col: 0 }, false, shown.length, false)).toEqual({ row: 2, col: 1 });
    expect(tabTarget({ row: 2, col: 3 }, true, shown.length, false)).toEqual({ row: 2, col: 2 });
    expect(tabTarget({ row: 2, col: shown.length - 1 }, false, shown.length, false)).toBeNull();
    expect(tabTarget({ row: 2, col: 0 }, true, shown.length, false)).toBeNull();
    expect(tabTarget({ row: 1, col: 0 }, false, shown.length, true)).toBeNull();
  });

  it("arrows, Home/End and Page Up/Down move within the grid", () => {
    expect(moveFocus({ row: 2, col: 2 }, "ArrowDown", { ctrl: false }, size)).toEqual({ row: 3, col: 2 });
    expect(moveFocus({ row: 2, col: 2 }, "Home", { ctrl: false }, size)).toEqual({ row: 2, col: 0 });
    expect(moveFocus({ row: 2, col: 2 }, "End", { ctrl: true }, size)).toEqual({ row: 4, col: shown.length - 1 });
    expect(moveFocus({ row: 3, col: 1 }, "PageUp", { ctrl: false }, size)).toEqual({ row: 1, col: 1 });
    expect(moveFocus({ row: 3, col: 1 }, "PageDown", { ctrl: false }, size)).toEqual({ row: 4, col: 1 });
  });
});
