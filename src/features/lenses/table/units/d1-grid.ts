"use client";

import * as React from "react";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensRow, LensValue } from "@/lib/query/run";
import type { LensT } from "@/features/lenses/i18n";
import { useLocale } from "@/lib/i18n/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { pasteLensCells, undoLensCells, type CellResult, type UndoCellsResult } from "@/features/lenses/services/lens.actions";
import { cellEditorFor, editorFor as legacyEditorFor, parseCellInput, PASTE_LIMIT, type CellOption, type EditorKind } from "../editable";
import { isRef, type CellPosition, type ColumnState, type DisplayRow } from "../model";
import { loadCellOptions } from "./d1-options";
import { D1Status } from "./d1-status";

/**
 * Wave 2 unit D1 (table cells): grid-wide keyboard, copy, paste and undo, and
 * which cells each viewer may edit. Only D1 edits this file (with
 * ../cell-editor.tsx and ../editable.ts). While the wos_objects switch is off
 * it handles nothing and edits the same cells as before.
 */

export interface GridUnitContext {
  type: CatalogType;
  /** Rows as displayed (group rows and record rows), in grid order from row 1. */
  display: DisplayRow[];
  shown: ColumnState[];
  properties: Map<string, CatalogProperty>;
  /** The focused cell (row 0 is the header). */
  focus: CellPosition;
  /** The cell being edited in place, if any. */
  editing: CellPosition | null;
  /** Ids of the rows ticked for a bulk edit. */
  selected: Set<string>;
  /** Saves one cell the same way an in-place edit does (optimistic, then the server). */
  commitCell: (row: LensRow, key: string, next: LensValue, raw: string | null) => Promise<void>;
  /** Tells screen readers what happened. */
  announce: (message: string) => void;
  t: LensT;
  /** Whether the wos_objects switch (change sets and undo) is on. */
  objectsEnabled?: boolean;
  /** Loads the rows again (after a paste or an undo changed them on the server). */
  reload?: () => void;
}

export interface GridUnitHandlers {
  /** Runs first on every key in the grid; return true when it handled the key. */
  onKeyDown?: (event: React.KeyboardEvent) => boolean;
  onCopy?: (event: React.ClipboardEvent) => void;
  onPaste?: (event: React.ClipboardEvent) => void;
  /** The editor for one cell of one row, or null when this viewer cannot edit it. */
  editorFor: (row: LensRow, key: string) => EditorKind | null;
  /** Hears the result of an in-place save, so it can be undone. */
  onSaved?: (result: CellResult) => void;
  /** What a paste or undo did, and the undo button, shown above the grid. */
  status?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in d1-grid.test.ts)
// ---------------------------------------------------------------------------

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function rangeOf(anchor: CellPosition | null, focus: CellPosition): CellRange {
  const a = anchor ?? focus;
  return {
    top: Math.min(a.row, focus.row),
    bottom: Math.max(a.row, focus.row),
    left: Math.min(a.col, focus.col),
    right: Math.max(a.col, focus.col),
  };
}

const quote = (text: string) => (/[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

/** Cells as tab-separated text, rows on lines, quoted like a spreadsheet when needed. */
export function toTsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(quote).join("\t")).join("\n");
}

/**
 * Whether the quote at `start` opens a quoted cell: one whose closing quote is
 * followed by a tab, a line break or the end. A lone leading quote (a title
 * like `"Phase 2`) is just text, as spreadsheets copy it.
 */
function closesQuote(source: string, start: number): boolean {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] !== '"') continue;
    if (source[i + 1] === '"') {
      i += 1;
      continue;
    }
    const next = source[i + 1];
    return next === undefined || next === "\t" || next === "\n";
  }
  return false;
}

/**
 * Tab-separated text (from a spreadsheet, or this table) as rows of cells. A
 * quoted cell may hold tabs, line breaks and doubled quotes. The trailing line
 * break spreadsheets add is dropped.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const source = text.replace(/\r\n?/g, "\n");
  while (i < source.length) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === "" && closesQuote(source, i)) {
      quoted = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * The text one cell copies as: what a person would type to get it back, so a
 * copied range pastes into this or another table unchanged. Dates are
 * YYYY-MM-DD, numbers plain, options and references by their label.
 */
export function copyText(property: CatalogProperty, value: LensValue, locale: string): string {
  if (value === null || value === undefined) return "";
  if (isRef(value)) return value.label ?? "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (property.kind === "date") return String(value).slice(0, 10);
  if (property.kind === "select" && property.choices) {
    const choice = property.choices.find((c) => c.key === value);
    if (choice) return locale.startsWith("fr") ? choice.label.fr : choice.label.en;
  }
  return String(value);
}

/** The cells a range covers, as text, one line per record row (group rows are left out). */
export function copyMatrix(
  range: CellRange,
  display: DisplayRow[],
  shown: ColumnState[],
  properties: Map<string, CatalogProperty>,
  locale: string,
): string[][] {
  const matrix: string[][] = [];
  for (let r = Math.max(1, range.top); r <= range.bottom; r++) {
    const item = display[r - 1];
    if (!item || item.kind !== "record") continue;
    const line: string[] = [];
    for (let c = range.left; c <= range.right; c++) {
      const key = shown[c]?.key;
      const property = key ? properties.get(key) : undefined;
      if (!key || !property) continue;
      line.push(copyText(property, key === "title" ? item.row.title : item.row.values[key] ?? null, locale));
    }
    matrix.push(line);
  }
  return matrix;
}

export interface PlannedCell {
  row: LensRow;
  key: string;
  raw: string | null;
}

export interface PastePlan {
  cells: PlannedCell[];
  /** Cells inside the table this person cannot edit (read-only rows, computed columns, group rows). */
  readOnly: number;
  /** Cells whose pasted value does not fit the column. */
  invalid: number;
}

/**
 * Which cells a paste writes. It starts at the top-left of the selection (or
 * the focused cell); a single copied value fills the whole selection. Cells
 * past the table's edge are left out; cells the person cannot edit, and
 * values that do not fit, are counted so the table can say so.
 */
export function planPaste(input: {
  matrix: string[][];
  range: CellRange;
  display: DisplayRow[];
  shown: ColumnState[];
  properties: Map<string, CatalogProperty>;
  editorFor: (row: LensRow, key: string) => EditorKind | null;
  options: (key: string) => CellOption[] | undefined;
  locale: string;
}): PastePlan {
  const { matrix, display, shown } = input;
  const start = { row: Math.max(1, input.range.top), col: input.range.left };
  const single = matrix.length === 1 && matrix[0].length === 1;
  const height = single ? input.range.bottom - start.row + 1 : matrix.length;
  const width = single ? input.range.right - start.col + 1 : Math.max(0, ...matrix.map((line) => line.length));
  const plan: PastePlan = { cells: [], readOnly: 0, invalid: 0 };
  for (let i = 0; i < height; i++) {
    const r = start.row + i;
    if (r > display.length) break;
    const item = display[r - 1];
    for (let j = 0; j < width; j++) {
      const c = start.col + j;
      if (c >= shown.length) break;
      const text = single ? matrix[0][0] : matrix[i]?.[j];
      if (text === undefined) continue;
      if (item.kind !== "record") {
        plan.readOnly += 1;
        continue;
      }
      const key = shown[c].key;
      const kind = input.editorFor(item.row, key);
      const property = input.properties.get(key);
      if (!kind || !property) {
        plan.readOnly += 1;
        continue;
      }
      const parsed = parseCellInput(kind, text, { property: key, locale: input.locale, choices: property.choices, options: input.options(key) });
      if (!parsed.ok) {
        plan.invalid += 1;
        continue;
      }
      plan.cells.push({ row: item.row, key, raw: parsed.raw });
    }
  }
  return plan;
}

/** Where Tab (or Shift+Tab) goes from a cell: along the row, or out of the grid at its ends. */
export function tabTarget(focus: CellPosition, shift: boolean, cols: number, isGroupRow: boolean): CellPosition | null {
  if (isGroupRow) return null;
  const col = focus.col + (shift ? -1 : 1);
  if (col < 0 || col >= cols) return null;
  return { row: focus.row, col };
}

/** The message after a paste, in the viewer's language. */
export function pasteMessage(t: LensT, counts: { saved: number; readOnly: number; invalid: number; failed: number }): string {
  const parts = [counts.saved === 1 ? t("units.d1.pastedOne") : t("units.d1.pasted", { count: counts.saved })];
  if (counts.readOnly > 0) parts.push(t("units.d1.skippedReadOnly", { count: counts.readOnly }));
  if (counts.invalid > 0) parts.push(t("units.d1.skippedInvalid", { count: counts.invalid }));
  if (counts.failed > 0) parts.push(t("units.d1.pasteFailed", { count: counts.failed }));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

const EDITABLE_BATCH = 500;
const RANGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
const NAVIGATION_KEYS = new Set([...RANGE_KEYS, "PageUp", "PageDown"]);
const RANGE_MARK = "data-d1-range";

export function useD1Grid(ctx: GridUnitContext): GridUnitHandlers {
  const { type, display, shown, properties, focus, editing, t } = ctx;
  const enabled = ctx.objectsEnabled === true;
  const locale = useLocale();
  const [editable, setEditable] = React.useState<ReadonlyMap<string, boolean>>(new Map());
  const [anchor, setAnchor] = React.useState<CellPosition | null>(null);
  const [undoStack, setUndoStack] = React.useState<string[][]>([]);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const gridRef = React.useRef<HTMLElement | null>(null);
  // The focus this unit moved to; any other move ends a range selection.
  const movedTo = React.useRef<string | null>(null);

  const { announce, reload } = ctx;
  const say = React.useCallback(
    (text: string) => {
      setMessage(text);
      announce(text);
    },
    [announce],
  );

  // Which records this viewer may edit: lens_editable answers with
  // public.can(id, 'edit_content'), so a read-only record never offers an
  // editor. Asked only for the rows on screen (and a paste's rows), a moment
  // after they appear, so a long table loads as fast as before.
  const asking = React.useRef(new Set<string>());
  const askEditable = React.useCallback(
    async (ids: string[]): Promise<Map<string, boolean>> => {
      const answers = new Map<string, boolean>();
      const wanted = ids.filter((id) => !asking.current.has(id));
      if (wanted.length === 0) return answers;
      for (const id of wanted) asking.current.add(id);
      let failed = false;
      try {
        const client = createSupabaseBrowserClient();
        for (let i = 0; i < wanted.length; i += EDITABLE_BATCH) {
          const batch = wanted.slice(i, i + EDITABLE_BATCH);
          const { data, error } = await client.rpc("lens_editable", { p_ids: batch });
          if (error) {
            failed = true;
            continue;
          }
          const yes = new Set((data as string[] | null) ?? []);
          for (const id of batch) answers.set(id, yes.has(id));
        }
      } catch {
        failed = true;
      }
      // Unanswered rows stay asked, so a failing check is not repeated in a
      // loop; they stay read-only and the line above the table says why.
      if (failed) say(t("units.d1.editableFailed"));
      if (answers.size > 0) setEditable((current) => new Map([...current, ...answers]));
      return answers;
    },
    [say, t],
  );

  const statusRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    // The grid sits next to the status line, inside the same table.
    const grid = statusRef.current?.parentElement?.querySelector<HTMLElement>('[role="grid"]') ?? null;
    if (grid) gridRef.current = grid;
    if (!grid) return;
    const missing: string[] = [];
    for (const element of grid.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')) {
      const item = display[Number(element.getAttribute("aria-rowindex")) - 2];
      if (item?.kind === "record" && !editable.has(item.row.id) && !asking.current.has(item.row.id)) missing.push(item.row.id);
    }
    if (missing.length === 0) return;
    const timer = window.setTimeout(() => void askEditable(missing), 120);
    return () => window.clearTimeout(timer);
  });

  const editorFor = React.useCallback(
    (row: LensRow, key: string): EditorKind | null => {
      if (!enabled) return legacyEditorFor(type.key, key);
      const kind = cellEditorFor(type.key, key);
      return kind && editable.get(row.id) === true ? kind : null;
    },
    [enabled, type.key, editable],
  );

  const range = rangeOf(anchor, focus);

  // A focus move this unit did not make (a click, a plain arrow) ends the range.
  React.useEffect(() => {
    const key = `${focus.row}:${focus.col}`;
    if (movedTo.current !== key) setAnchor(null);
    movedTo.current = null;
  }, [focus.row, focus.col]);

  // Mark the selected range on the rendered cells.
  React.useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    for (const cell of grid.querySelectorAll<HTMLElement>(`[${RANGE_MARK}]`)) {
      cell.removeAttribute(RANGE_MARK);
      cell.removeAttribute("aria-selected");
      cell.style.boxShadow = "";
    }
    if (!anchor) return;
    for (let r = Math.max(1, range.top); r <= range.bottom; r++) {
      for (let c = range.left; c <= range.right; c++) {
        const cell = grid.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`);
        if (!cell || cell.getAttribute("role") !== "gridcell") continue;
        cell.setAttribute(RANGE_MARK, "");
        cell.setAttribute("aria-selected", "true");
        cell.style.boxShadow = "inset 0 0 0 9999px color-mix(in srgb, var(--color-brand) 14%, transparent)";
      }
    }
  });

  const focusCell = (pos: CellPosition) => {
    movedTo.current = `${pos.row}:${pos.col}`;
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${pos.row}:${pos.col}"]`)?.focus();
  };

  const undoing = React.useRef(false);
  // Set while a copy shortcut runs the copy command (see onKeyDown).
  const copyingFromKey = React.useRef(false);
  const undo = React.useCallback(async () => {
    if (undoing.current) return;
    const last = undoStack[undoStack.length - 1];
    if (!last) {
      say(t("units.d1.nothingToUndo"));
      return;
    }
    undoing.current = true;
    setBusy(true);
    let result: UndoCellsResult;
    try {
      result = await undoLensCells({ changeSetIds: last }).catch(() => ({ ok: false, error: t("units.d1.undoFailed"), undone: 0 }));
    } finally {
      undoing.current = false;
      setBusy(false);
    }
    // Newest first: what is left is the start of the entry. It stays to try
    // again unless someone changed those values since.
    const remaining = last.slice(0, last.length - result.undone);
    const keep = !result.ok && !result.conflict && remaining.length > 0;
    setUndoStack((stack) => {
      const index = stack.lastIndexOf(last);
      if (index < 0) return stack;
      return keep ? stack.map((entry, i) => (i === index ? remaining : entry)) : stack.filter((_, i) => i !== index);
    });
    if (result.undone > 0) reload?.();
    const error = result.error ?? t("units.d1.undoFailed");
    say(result.ok ? t("units.d1.undone") : result.undone > 0 ? `${t("units.d1.undoPartial", { count: result.undone })} ${error}` : error);
  }, [undoStack, reload, say, t]);

  if (!enabled) return { editorFor };

  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    gridRef.current = event.currentTarget as HTMLElement;
    if (editing) return false;
    if (!(event.target as HTMLElement).dataset?.cell) return false;
    const mod = event.ctrlKey || event.metaKey;

    if (mod && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void undo();
      return true;
    }
    // Safari fires no copy event for a shortcut pressed on a focused cell when
    // no text is selected, so the range was never copied there. Copying from
    // the key press works in every browser: the copy command, with the cells
    // put on the clipboard by a one-time listener, or the Clipboard API when
    // the command is refused.
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c" && window.getSelection()?.isCollapsed !== false) {
      const copied = copiedRange();
      if (!copied) return false;
      event.preventDefault();
      let written = false;
      const put = (e: ClipboardEvent) => {
        if (!e.clipboardData) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", copied.text);
        written = true;
      };
      document.addEventListener("copy", put, { capture: true, once: true });
      copyingFromKey.current = true;
      try {
        document.execCommand("copy");
      } catch {
        // Refused: the Clipboard API below.
      } finally {
        copyingFromKey.current = false;
        document.removeEventListener("copy", put, { capture: true });
      }
      if (written) say(copied.message);
      else {
        void navigator.clipboard?.writeText(copied.text).then(
          () => say(copied.message),
          () => undefined,
        );
      }
      return true;
    }
    if (event.key === "Tab") {
      const item = focus.row >= 1 ? display[focus.row - 1] : undefined;
      const next = tabTarget(focus, event.shiftKey, shown.length, item?.kind === "group");
      if (!next) return false;
      event.preventDefault();
      setAnchor(null);
      focusCell(next);
      return true;
    }
    if (event.key === "Escape" && anchor) {
      event.preventDefault();
      setAnchor(null);
      return true;
    }
    if (event.shiftKey && !event.altKey && RANGE_KEYS.has(event.key) && focus.row >= 1) {
      const item = display[focus.row - 1];
      if (item?.kind !== "record") return false;
      event.preventDefault();
      const row =
        event.key === "ArrowUp" ? Math.max(1, focus.row - 1) : event.key === "ArrowDown" ? Math.min(display.length, focus.row + 1) : focus.row;
      const col =
        event.key === "ArrowLeft" || event.key === "Home"
          ? event.key === "Home"
            ? 0
            : Math.max(0, focus.col - 1)
          : event.key === "ArrowRight" || event.key === "End"
            ? event.key === "End"
              ? shown.length - 1
              : Math.min(shown.length - 1, focus.col + 1)
            : focus.col;
      const start = anchor ?? focus;
      setAnchor(start);
      focusCell({ row, col });
      const next = rangeOf(start, { row, col });
      announce(t("units.d1.range", { rows: next.bottom - next.top + 1, cols: next.right - next.left + 1 }));
      return true;
    }
    if (NAVIGATION_KEYS.has(event.key) && anchor) setAnchor(null);
    return false;
  };

  /** The selected cells as tab-separated text, and what to announce; null when there is nothing to copy. */
  const copiedRange = (): { text: string; message: string } | null => {
    if (editing || focus.row < 1) return null;
    const matrix = copyMatrix(range, display, shown, properties, locale);
    const count = matrix.reduce((sum, line) => sum + line.length, 0);
    if (count === 0) return null;
    return { text: toTsv(matrix), message: count === 1 ? t("units.d1.copiedOne") : t("units.d1.copied", { count }) };
  };

  const onCopy = (event: React.ClipboardEvent) => {
    gridRef.current = event.currentTarget as HTMLElement;
    // The key press already put the cells on the clipboard and said so.
    if (copyingFromKey.current) return;
    const copied = copiedRange();
    if (!copied) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", copied.text);
    say(copied.message);
  };

  const onPaste = (event: React.ClipboardEvent) => {
    gridRef.current = event.currentTarget as HTMLElement;
    if (editing || busy || undoing.current) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const matrix = parseTsv(text);
    const target = focus.row < 1 ? { ...range, top: 1, bottom: Math.max(1, range.bottom) } : range;
    void paste(matrix, target);
  };

  const paste = async (matrix: string[][], target: CellRange) => {
    setBusy(true);
    say(t("units.d1.pasting"));
    try {
      // Person and relation cells match pasted names against what this viewer can see.
      const lists = new Map<string, CellOption[]>();
      const width = Math.max(target.right - target.left + 1, ...matrix.map((line) => line.length));
      for (let c = target.left; c < Math.min(shown.length, target.left + width); c++) {
        const key = shown[c].key;
        const kind = cellEditorFor(type.key, key);
        const property = properties.get(key);
        if (property && (kind === "person" || kind === "relation")) {
          lists.set(key, await loadCellOptions(kind, property, []).catch(() => []));
        }
      }
      const rows = display.slice(Math.max(0, target.top - 1), target.top - 1 + Math.max(matrix.length, target.bottom - target.top + 1));
      const unknown = rows.flatMap((item) => (item.kind === "record" && !editable.has(item.row.id) ? [item.row.id] : []));
      const answered = unknown.length > 0 ? await askEditable(unknown) : new Map<string, boolean>();
      const canEdit = (row: LensRow, key: string) => {
        const kind = cellEditorFor(type.key, key);
        return kind && (editable.get(row.id) ?? answered.get(row.id)) === true ? kind : null;
      };
      const plan = planPaste({ matrix, range: target, display, shown, properties, editorFor: canEdit, options: (key) => lists.get(key), locale });
      if (plan.cells.length > PASTE_LIMIT) {
        say(t("units.d1.pasteTooLarge", { count: PASTE_LIMIT }));
        return;
      }
      if (plan.cells.length === 0) {
        say(pasteMessage(t, { saved: 0, readOnly: plan.readOnly, invalid: plan.invalid, failed: 0 }));
        return;
      }
      const result = await pasteLensCells({
        type: type.key,
        cells: plan.cells.map((cell) => ({ id: cell.row.id, property: cell.key, value: cell.raw })),
      }).catch(() => null);
      if (!result) {
        say(t("units.d1.failed"));
        return;
      }
      if (!result.ok) {
        say(result.error ?? t("units.d1.failed"));
        return;
      }
      if (result.changeSetIds.length > 0) setUndoStack((stack) => [...stack, result.changeSetIds]);
      if (result.saved > 0) reload?.();
      say(pasteMessage(t, { saved: result.saved, readOnly: plan.readOnly + result.refused, invalid: plan.invalid, failed: result.failed }));
    } finally {
      setBusy(false);
    }
  };

  const onSaved = (result: CellResult) => {
    if (result.ok && result.changeSetId) setUndoStack((stack) => [...stack, [result.changeSetId!]]);
  };

  return {
    onKeyDown,
    onCopy,
    onPaste,
    editorFor,
    onSaved,
    status: React.createElement(D1Status, { anchorRef: statusRef, message, canUndo: undoStack.length > 0, busy, onUndo: () => void undo(), t }),
  };
}
