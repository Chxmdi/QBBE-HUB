/**
 * The table lens's behaviour as pure functions (M8b): column layout, grouped
 * display rows, totals, grid keyboard movement and the virtual window. The
 * component only wires these to the DOM, so the rules are unit-tested here.
 */

import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensGroupCount, LensRow, LensValue } from "@/lib/query/run";
import type { LensSpec } from "@/lib/query/spec";

export const MIN_WIDTH = 80;
export const MAX_WIDTH = 640;
export const WIDTH_STEP = 40;
export const ROW_HEIGHT = 36;
/** The engine's page size; the table loads pages until it has every row. */
export const PAGE_SIZE = 1000;
/** Rows a table loads at most (the engine's offset cap plus one page). */
export const MAX_ROWS = 11_000;

export interface ColumnState {
  key: string;
  width: number;
  hidden: boolean;
}

export interface TableState {
  columns: ColumnState[];
  sort: { property: string; direction: "asc" | "desc" } | null;
  groupBy: string | null;
  search: string;
}

/** Title first and wide; every other shown property after it in catalog order. */
export function defaultColumns(type: CatalogType): ColumnState[] {
  return type.properties.filter((p) => !p.filterOnly).map((p) => ({
    key: p.key,
    width: p.key === "title" ? 320 : 160,
    hidden: false,
  }));
}

/**
 * Applies a saved layout to the current catalog: unknown keys are dropped,
 * new properties are appended, widths are clamped. A layout saved before a
 * property existed (or after one was removed) still loads.
 */
export function reconcileColumns(type: CatalogType, saved: ColumnState[] | null | undefined): ColumnState[] {
  const defaults = defaultColumns(type);
  if (!Array.isArray(saved)) return defaults;
  const known = new Set(defaults.map((c) => c.key));
  const seen = new Set<string>();
  const kept: ColumnState[] = [];
  for (const c of saved) {
    if (!c || typeof c.key !== "string" || !known.has(c.key) || seen.has(c.key)) continue;
    seen.add(c.key);
    kept.push({ key: c.key, width: clampWidth(Number(c.width) || 160), hidden: c.key === "title" ? false : c.hidden === true });
  }
  return [...kept, ...defaults.filter((c) => !seen.has(c.key))];
}

export function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

export function resizeColumn(columns: ColumnState[], key: string, width: number): ColumnState[] {
  return columns.map((c) => (c.key === key ? { ...c, width: clampWidth(width) } : c));
}

/** Moves a column one place among the visible columns. The title stays first. */
export function moveColumn(columns: ColumnState[], key: string, direction: -1 | 1): ColumnState[] {
  if (key === "title") return columns;
  const visible = columns.filter((c) => !c.hidden);
  const index = visible.findIndex((c) => c.key === key);
  const target = visible[index + direction];
  if (index < 0 || !target || target.key === "title") return columns;
  const next = [...columns];
  const a = next.findIndex((c) => c.key === key);
  const b = next.findIndex((c) => c.key === target.key);
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** The title can never be hidden: every row needs a name. */
export function setHidden(columns: ColumnState[], key: string, hidden: boolean): ColumnState[] {
  if (key === "title") return columns;
  return columns.map((c) => (c.key === key ? { ...c, hidden } : c));
}

export function visibleColumns(columns: ColumnState[]): ColumnState[] {
  return columns.filter((c) => !c.hidden);
}

/** The spec the table asks the engine for. */
export function specFor(typeKey: string, state: TableState, offset = 0): LensSpec {
  const select = visibleColumns(state.columns)
    .map((c) => c.key)
    .filter((k) => k !== "title")
    .slice(0, 30);
  const search = state.search.trim().slice(0, 500);
  return {
    version: 1,
    type: typeKey,
    ...(search ? { where: { and: [{ property: "title", operator: "contains", value: search }] } } : {}),
    ...(state.sort ? { sort: [state.sort] } : {}),
    ...(state.groupBy ? { groupBy: { property: state.groupBy } } : {}),
    select,
    limit: PAGE_SIZE,
    offset,
  };
}

// ---------------------------------------------------------------------------
// Display rows
// ---------------------------------------------------------------------------

export type DisplayRow =
  | { kind: "group"; key: string | null; label: string; count: number; collapsed: boolean }
  | { kind: "record"; row: LensRow };

/**
 * Rows in display order, with a header row before each group. The engine
 * already sorts by the group first, so rows arrive group by group.
 */
export function buildDisplayRows(
  rows: LensRow[],
  groups: LensGroupCount[] | null,
  groupLabel: (group: LensGroupCount) => string,
  collapsed: ReadonlySet<string>,
): DisplayRow[] {
  if (!groups) return rows.map((row) => ({ kind: "record", row }));
  const byKey = new Map<string | null, LensRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.group) ?? [];
    list.push(row);
    byKey.set(row.group, list);
  }
  const out: DisplayRow[] = [];
  for (const group of groups) {
    const id = groupId(group.key);
    const isCollapsed = collapsed.has(id);
    out.push({ kind: "group", key: group.key, label: groupLabel(group), count: group.total, collapsed: isCollapsed });
    if (!isCollapsed) for (const row of byKey.get(group.key) ?? []) out.push({ kind: "record", row });
  }
  return out;
}

/** A stable id for a group, including the empty group. */
export function groupId(key: string | null): string {
  return key === null ? "\u0000empty" : key;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export function numberTotals(rows: LensRow[], properties: CatalogProperty[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of properties) {
    if (p.kind !== "number") continue;
    let sum = 0;
    for (const row of rows) {
      const v = row.values[p.key];
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
      else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) sum += Number(v);
    }
    // Two decimals is the precision of every number column today (hours).
    totals[p.key] = Math.round(sum * 100) / 100;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Grid keyboard movement (WAI-ARIA grid pattern)
// ---------------------------------------------------------------------------

export interface CellPosition {
  /** 0 is the header row; display rows start at 1. */
  row: number;
  col: number;
}

export interface GridSize {
  rows: number;
  cols: number;
  pageRows: number;
}

/** Where focus goes for a key, or null when the key is not a grid key. */
export function moveFocus(
  pos: CellPosition,
  key: string,
  modifiers: { ctrl: boolean },
  size: GridSize,
): CellPosition | null {
  const lastRow = size.rows - 1;
  const lastCol = size.cols - 1;
  const clamp = (row: number, col: number): CellPosition => ({
    row: Math.min(lastRow, Math.max(0, row)),
    col: Math.min(lastCol, Math.max(0, col)),
  });
  switch (key) {
    case "ArrowUp":
      return clamp(pos.row - 1, pos.col);
    case "ArrowDown":
      return clamp(pos.row + 1, pos.col);
    case "ArrowLeft":
      return clamp(pos.row, pos.col - 1);
    case "ArrowRight":
      return clamp(pos.row, pos.col + 1);
    case "Home":
      return modifiers.ctrl ? clamp(0, 0) : clamp(pos.row, 0);
    case "End":
      return modifiers.ctrl ? clamp(lastRow, lastCol) : clamp(pos.row, lastCol);
    case "PageUp":
      return clamp(pos.row - size.pageRows, pos.col);
    case "PageDown":
      return clamp(pos.row + size.pageRows, pos.col);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Virtual window
// ---------------------------------------------------------------------------

/** The slice of rows to render for a scroll position, with some to spare. */
export function virtualWindow(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  overscan = 10,
): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT);
  const visible = Math.ceil(Math.max(viewportHeight, ROW_HEIGHT) / ROW_HEIGHT);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}

/** Keeps a focused row inside the rendered window. */
export function ensureInWindow(
  index: number,
  window: { start: number; end: number },
  count: number,
  overscan = 10,
): { start: number; end: number } {
  if (index >= window.start && index < window.end) return window;
  const size = Math.max(window.end - window.start, 1);
  const start = Math.max(0, Math.min(index - overscan, count - size));
  return { start, end: Math.min(count, start + size) };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function isRef(value: LensValue): value is { id: string; label: string | null } {
  return typeof value === "object" && value !== null && "id" in value;
}

/** The text a cell shows (before locale formatting of dates and numbers). */
export function rawText(property: CatalogProperty, value: LensValue, locale: string): string | null {
  if (value === null || value === undefined) return null;
  if (isRef(value)) return value.label ?? null;
  if (property.kind === "select" && property.choices) {
    const choice = property.choices.find((c) => c.key === value);
    if (choice) return locale.startsWith("fr") ? choice.label.fr : choice.label.en;
  }
  if (typeof value === "boolean") return value ? "✓" : "";
  return String(value);
}
