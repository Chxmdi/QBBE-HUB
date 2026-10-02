"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import type { LensT } from "@/features/lenses/i18n";
import type { ColumnMenuItem } from "../column-menu";
import { numberTotals, ROW_HEIGHT, type CellPosition, type ColumnState, type TableState } from "../model";

/**
 * Wave 2 unit D2 (table columns): the totals row under the table and extra
 * column-menu entries. Only D2 edits this file. Until D2 lands it keeps the
 * table's existing behaviour: a sum of the loaded rows under number columns,
 * and no extra menu entries.
 */

export interface TotalsRowProps {
  type: CatalogType;
  /** The rows loaded on the client (at most MAX_ROWS). */
  rows: LensRow[];
  /** The table's current state; specFor(type, state) is the query it shows. */
  state: TableState;
  shown: ColumnState[];
  properties: Map<string, CatalogProperty>;
  /** aria-rowindex of the totals row (the last grid row). */
  gridRows: number;
  tabIndexFor: (row: number, col: number) => number;
  onFocusCell: (pos: CellPosition) => void;
  locale: Locale;
  timeZone: string;
  t: LensT;
}

/** Whether the table shows a totals row for these columns. */
export function d2HasTotalsRow(shown: ColumnState[], properties: Map<string, CatalogProperty>): boolean {
  return shown.some((c) => properties.get(c.key)?.kind === "number");
}

export function D2TotalsRow({ type, rows, shown, properties, gridRows, tabIndexFor, onFocusCell, locale, t }: TotalsRowProps) {
  const totals = React.useMemo(() => numberTotals(rows, type.properties), [rows, type.properties]);
  const collator = React.useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }), [locale]);
  const nameOf = (p: CatalogProperty) => (locale.startsWith("fr") ? p.name.fr : p.name.en);
  return (
    <div role="rowgroup" className="sticky bottom-0 bg-surface-soft">
      <div role="row" aria-rowindex={gridRows} className="flex border-t border-line font-semibold">
        {shown.map((c, col) => {
          const p = properties.get(c.key)!;
          const isNumber = p.kind === "number";
          return (
            <div
              key={c.key}
              role="gridcell"
              aria-colindex={col + 1}
              aria-readonly
              tabIndex={tabIndexFor(gridRows - 1, col)}
              data-cell={`${gridRows - 1}:${col}`}
              onFocus={() => onFocusCell({ row: gridRows - 1, col })}
              style={{ width: c.width, height: ROW_HEIGHT }}
              className={cn(
                "flex shrink-0 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                isNumber && "justify-end tabular-nums",
              )}
            >
              {col === 0 ? t("table.sum") : isNumber ? (
                <span>
                  <span className="sr-only">{`${t("table.sum")} ${nameOf(p)}: `}</span>
                  {collator.format(totals[c.key] ?? 0)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ColumnItemsContext {
  type: CatalogType;
  /** The column's property. */
  property: CatalogProperty;
  state: TableState;
  update: (change: (s: TableState) => TableState) => void;
  t: LensT;
}

/** Entries D2 adds to the end of a column's header menu. */
export const d2ColumnItems: (ctx: ColumnItemsContext) => ColumnMenuItem[] = () => [];
