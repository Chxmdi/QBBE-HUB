/**
 * The table lens's behaviour as pure functions (M8b): column layout, grouped
 * display rows, totals, grid keyboard movement and the virtual window. The
 * component only wires these to the DOM, so the rules are unit-tested here.
 */

import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensGroupCount, LensRow, LensValue } from "@/lib/query/run";
import { LIMITS, lensSpecSchema, type LensGroup, type LensNode, type LensSpec } from "@/lib/query/spec";

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

export interface SortKey {
  property: string;
  direction: "asc" | "desc";
}

/** Sort keys a table asks for at most (the engine's limit). */
export const MAX_SORTS = LIMITS.maxSorts;

export interface TableState {
  columns: ColumnState[];
  /** Up to three keys, first one first. */
  sort: SortKey[];
  groupBy: string | null;
  search: string;
  /** The filter builder's where clause, combined with the title search. */
  where?: LensGroup | null;
}

/**
 * What a header click does to the sort. A plain click sorts by this column
 * only: ascending, then descending on a second click, then not at all. An
 * additive click (Shift, or "Then by" in the menu) appends the column as a
 * later key, replacing the last one when three are already there.
 */
export function toggleSort(sort: SortKey[], property: string, additive = false): SortKey[] {
  const index = sort.findIndex((k) => k.property === property);
  if (!additive) {
    if (index < 0 || sort.length > 1) return [{ property, direction: "asc" }];
    return sort[0].direction === "asc" ? [{ property, direction: "desc" }] : [];
  }
  if (index >= 0) {
    return sort.map((k, i) => (i === index ? { ...k, direction: k.direction === "asc" ? "desc" : "asc" } : k));
  }
  const kept = sort.length >= MAX_SORTS ? sort.slice(0, MAX_SORTS - 1) : sort;
  return [...kept, { property, direction: "asc" }];
}

/** Sets or appends a key with a direction; appending past three replaces the last. */
export function setSortKey(sort: SortKey[], key: SortKey, append: boolean): SortKey[] {
  const without = sort.filter((k) => k.property !== key.property);
  if (!append) return [key];
  const kept = without.length >= MAX_SORTS ? without.slice(0, MAX_SORTS - 1) : without;
  return [...kept, key];
}

export function removeSortKey(sort: SortKey[], property: string): SortKey[] {
  return sort.filter((k) => k.property !== property);
}

/** Only sortable, known properties, each once, at most three. */
export function sanitiseSort(type: CatalogType, sort: unknown): SortKey[] {
  if (!Array.isArray(sort)) return [];
  const out: SortKey[] = [];
  for (const k of sort) {
    if (!k || typeof k !== "object") continue;
    const property = (k as { property?: unknown }).property;
    const direction = (k as { direction?: unknown }).direction;
    if (typeof property !== "string" || out.some((x) => x.property === property)) continue;
    if (!type.properties.some((p) => p.key === property && p.sortable)) continue;
    out.push({ property, direction: direction === "desc" ? "desc" : "asc" });
    if (out.length >= MAX_SORTS) break;
  }
  return out;
}

/** A where clause the engine will accept for this type, or null: the schema's shape and the catalog's properties. */
export function sanitiseWhere(type: CatalogType, where: unknown): LensGroup | null {
  if (!where || typeof where !== "object") return null;
  const parsed = lensSpecSchema.safeParse({ version: 1, type: type.key, where });
  if (!parsed.success || !parsed.data.where) return null;
  const known = new Set(type.properties.map((p) => p.key));
  const valid = (node: LensNode): boolean => {
    if ("property" in node) {
      if (!known.has(node.property)) return false;
      // A relation sub-query names another type's properties; the engine checks those.
      return true;
    }
    return ("and" in node ? node.and : node.or).every(valid);
  };
  return valid(parsed.data.where) ? parsed.data.where : null;
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
  const where = combineWhere(state.where ?? null, search ? { property: "title", operator: "contains", value: search } : null);
  return {
    version: 1,
    type: typeKey,
    ...(where ? { where } : {}),
    ...(state.sort.length ? { sort: state.sort.slice(0, MAX_SORTS) } : {}),
    ...(state.groupBy ? { groupBy: { property: state.groupBy } } : {}),
    select,
    limit: PAGE_SIZE,
    offset,
  };
}

/**
 * The builder's clause and the title search as one clause. An AND root takes
 * the search as one more item; an OR root is wrapped, which is one level
 * deeper (the builder leaves room for it).
 */
export function combineWhere(where: LensGroup | null, search: LensNode | null): LensGroup | undefined {
  if (!where) return search ? { and: [search] } : undefined;
  if (!search) return where;
  if ("and" in where) return { and: [...where.and, search] };
  return { and: [where, search] };
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

/**
 * The table state a saved lens opens with: its columns, sort, grouping and
 * conditions. Anything the table cannot show (an unknown column, a second
 * sort key) is dropped rather than failing the page.
 */
export function stateFromLens(
  type: CatalogType,
  spec: Partial<LensSpec> | Record<string, unknown>,
  layout: { columns?: ColumnState[] } | Record<string, unknown>,
): TableState {
  const s = spec as Partial<LensSpec>;
  const groupable = s.groupBy && type.properties.some((p) => p.key === s.groupBy!.property && p.groupable);
  return {
    columns: reconcileColumns(type, (layout as { columns?: ColumnState[] }).columns ?? null),
    sort: sanitiseSort(type, s.sort),
    groupBy: groupable ? s.groupBy!.property : null,
    search: "",
    where: sanitiseWhere(type, s.where),
  };
}

/** What one viewer keeps for themselves on a shared lens (lens_viewer_setting). */
export interface ViewerSetting {
  layout: { columns?: ColumnState[] } | Record<string, unknown>;
  sort: unknown;
  where: unknown;
}

/**
 * The lens's state with the viewer's own columns, sort and filters on top.
 * Each part is applied only when the setting has it, and only when it is
 * valid for the catalog, so a stale setting falls back to the lens.
 */
export function applyViewerSetting(type: CatalogType, state: TableState, setting: ViewerSetting | null | undefined): TableState {
  if (!setting) return state;
  const columns = (setting.layout as { columns?: ColumnState[] })?.columns;
  const hasWhere = setting.where !== undefined;
  return {
    ...state,
    columns: Array.isArray(columns) ? reconcileColumns(type, columns) : state.columns,
    sort: Array.isArray(setting.sort) ? sanitiseSort(type, setting.sort) : state.sort,
    where: hasWhere ? sanitiseWhere(type, setting.where) : state.where,
  };
}
