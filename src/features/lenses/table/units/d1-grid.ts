"use client";

import type * as React from "react";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensRow, LensValue } from "@/lib/query/run";
import type { LensT } from "@/features/lenses/i18n";
import type { CellPosition, ColumnState, DisplayRow } from "../model";

/**
 * Wave 2 unit D1 (table cells): grid-wide keyboard, copy and paste. Only D1
 * edits this file (with ../cell-editor.tsx and ../editable.ts). Until D1
 * lands it handles nothing, so the table behaves as before.
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
}

export interface GridUnitHandlers {
  /** Runs first on every key in the grid; return true when it handled the key. */
  onKeyDown?: (event: React.KeyboardEvent) => boolean;
  onCopy?: (event: React.ClipboardEvent) => void;
  onPaste?: (event: React.ClipboardEvent) => void;
}

const NO_HANDLERS: GridUnitHandlers = Object.freeze({});

export const useD1Grid: (ctx: GridUnitContext) => GridUnitHandlers = () => NO_HANDLERS;
