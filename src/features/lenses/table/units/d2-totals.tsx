"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { runLensAggregate, type AggregateResult, type AggregateValue } from "@/lib/query/aggregate";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LensT } from "@/features/lenses/i18n";
import { formatLensValue } from "@/features/lenses/format";
import {
  renameColumnForEveryone,
  saveTotalsChoice,
  setColumnHiddenForEveryone,
} from "@/features/lenses/services/d2-columns.actions";
import type { ColumnMenuItem } from "../column-menu";
import { ROW_HEIGHT, type CellPosition, type ColumnState, type TableState } from "../model";
import {
  aggregateSpecFor,
  allowedTotals,
  d2Info,
  groupTotalsRows,
  measuresFor,
  overallTotals,
  totalFor,
  type TotalChoice,
  type TotalsChoices,
} from "./d2-model";

/**
 * Wave 2 unit D2 (table columns): the totals row under the table and extra
 * column-menu entries. Only D2 edits this file.
 *
 * Totals come from `lens_aggregate` over the table's own spec (filters,
 * search and grouping), so they cover every matching row the viewer can open,
 * not only the rows loaded in the browser. Each column's total is the
 * viewer's choice, kept for them in lens_totals_setting. Owners and admins
 * also get column entries to rename, hide and add columns for everyone.
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

/** Whether the table shows a totals row for these columns: every column can count. */
export function d2HasTotalsRow(shown: ColumnState[], properties: Map<string, CatalogProperty>): boolean {
  return shown.some((c) => properties.has(c.key));
}

const REFRESH_DELAY = 300;

// Column-menu entries (rendered by the table) open dialogs the totals row
// hosts. They talk through this channel, keyed by type.
type ColumnRequest = {
  kind: "rename" | "hide" | "add";
  typeKey: string;
  property: string;
  update: (change: (s: TableState) => TableState) => void;
};
const columnRequests = new EventTarget();
const REQUEST = "d2-column";

function nameIn(locale: string, name: { en: string; fr: string }) {
  return locale.startsWith("fr") ? name.fr : name.en;
}

export function fnLabel(t: LensT, property: CatalogProperty, fn: TotalChoice): string {
  if (property.kind === "date" && (fn === "min" || fn === "max")) return t(`units.d2.totals.dateFn.${fn}`);
  return t(`units.d2.totals.fn.${fn}`);
}

export function D2TotalsRow({ type, rows, state, shown, properties, gridRows, tabIndexFor, onFocusCell, locale, timeZone, t }: TotalsRowProps) {
  const info = d2Info(type);
  const router = useRouter();
  const { toast } = useToast();
  const [choices, setChoices] = React.useState<TotalsChoices>(() => info?.totals ?? {});
  // The last answer, with the query and measures it answers.
  const [answer, setAnswer] = React.useState<{ specKey: string; measuresKey: string; result: AggregateResult } | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "failed">("loading");
  const [nonce, setNonce] = React.useState(0);
  const [menu, setMenu] = React.useState<{ col: number; place: React.CSSProperties } | null>(null);
  const [groupsOpen, setGroupsOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<ColumnRequest | null>(null);
  const [adding, setAdding] = React.useState<ColumnRequest | null>(null);
  const requestId = React.useRef(0);
  // Saves go one after another, so an older choice never lands after a newer one.
  const saving = React.useRef<Promise<unknown>>(Promise.resolve());
  const groupRef = React.useRef<HTMLDivElement>(null);
  const row = gridRows - 1;

  const { columns, measures } = React.useMemo(() => measuresFor(shown, properties, choices), [shown, properties, choices]);
  const spec = React.useMemo(() => aggregateSpecFor(type.key, state), [type.key, state]);
  const specKey = JSON.stringify(spec);
  const measuresKey = JSON.stringify(measures);

  // Re-total when the query, the chosen totals or the loaded rows (an edit,
  // a reload) change, a moment after they settle; stale answers are dropped.
  React.useEffect(() => {
    if (measuresKey === "[]") return;
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void runLensAggregate(createSupabaseBrowserClient(), JSON.parse(specKey), JSON.parse(measuresKey), { timeZone })
        .then((result) => {
          if (id !== requestId.current) return;
          setAnswer({ specKey, measuresKey, result });
          setStatus("ready");
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setStatus("failed");
        });
    }, REFRESH_DELAY);
    return () => window.clearTimeout(timer);
  }, [specKey, measuresKey, rows, nonce, timeZone]);

  const nameOf = (p: CatalogProperty) => nameIn(locale, p.name);
  const integer = React.useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0 }), [locale]);
  const decimal = React.useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }), [locale]);

  const formatTotal = (p: CatalogProperty, fn: TotalChoice, value: AggregateValue | undefined): string => {
    if (value === null || value === undefined) return t("units.d2.totals.noValue");
    if (fn === "count" || fn === "count_empty" || fn === "count_filled") return integer.format(Number(value));
    if (p.kind === "date") return formatLensValue(p, String(value), locale, timeZone) || t("units.d2.totals.noValue");
    return decimal.format(Number(value));
  };

  // Values shown: only an answer to the query and measures now asked for.
  const result = answer && answer.specKey === specKey && answer.measuresKey === measuresKey ? answer.result : null;
  const current = result ? overallTotals(result, columns) : null;
  const grouped = Boolean(state.groupBy) && result?.groups != null;
  const busy = measures.length > 0 && status === "loading";

  const choose = (p: CatalogProperty, fn: TotalChoice) => {
    const next = { ...choices, [p.key]: fn };
    setChoices(next);
    saving.current = saving.current
      .then(() => saveTotalsChoice({ type: type.key, choices: next }))
      .then((answer) => {
        if (!answer.ok) toast(answer.error ?? t("units.d2.totals.saveFailed"), { tone: "error" });
      })
      .catch(() => toast(t("units.d2.totals.saveFailed"), { tone: "error" }));
  };

  const focusCell = (col: number) => {
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-d2-total="${type.key}:${col}"]`)?.focus();
    }, 0);
  };

  // Back to the column's header (or the first one) once a column dialog closes.
  const focusHeader = (key: string) => {
    window.setTimeout(() => {
      const grid = groupRef.current?.closest('[role="grid"]');
      const col = Math.max(0, shown.findIndex((c) => c.key === key));
      (grid?.querySelector<HTMLElement>(`[data-cell="0:${col}"]`) ?? grid?.querySelector<HTMLElement>('[data-cell="0:0"]'))?.focus();
    }, 0);
  };

  async function hideColumn(request: ColumnRequest) {
    const p = properties.get(request.property);
    if (!p) return;
    const answer = await setColumnHiddenForEveryone({ type: type.key, property: p.key, hidden: true });
    if (!answer.ok) {
      toast(answer.error ?? t("units.d2.columns.failed"), { tone: "error" });
      return;
    }
    request.update((s) => ({ ...s, columns: s.columns.filter((c) => c.key !== p.key) }));
    focusHeader("title");
    toast(t("units.d2.columns.hidden", { column: nameOf(p) }), { tone: "success" });
    router.refresh();
  }

  // Column requests from the header menus of this table.
  React.useEffect(() => {
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<ColumnRequest>).detail;
      if (request.typeKey !== type.key) return;
      if (request.kind === "rename") setRenaming(request);
      else if (request.kind === "add") setAdding(request);
      else void hideColumn(request);
    };
    columnRequests.addEventListener(REQUEST, onRequest);
    return () => columnRequests.removeEventListener(REQUEST, onRequest);
  });

  const menuProperty = menu === null ? undefined : properties.get(shown[menu.col]?.key ?? "");

  // Open a cell's menu fixed to the viewport above (or below) the cell, so
  // the table's scroll area never clips it.
  const openMenu = (col: number, cell: HTMLElement) => {
    const rect = cell.getBoundingClientRect();
    const width = Math.min(224, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const above = rect.top > window.innerHeight / 2;
    setMenu({ col, place: above ? { left, width, bottom: window.innerHeight - rect.top + 4 } : { left, width, top: rect.bottom + 4 } });
  };

  return (
    <div ref={groupRef} role="rowgroup" className="sticky bottom-0 bg-surface-soft">
      <div role="row" aria-rowindex={gridRows} className="flex border-t border-line font-semibold">
        {shown.map((c, col) => {
          const p = properties.get(c.key);
          if (!p) return null;
          const fn = totalFor(p, choices);
          const measured = columns.some((m) => m.column === c.key);
          const value = current?.[c.key];
          const shownValue = fn === "none" || !measured ? "" : status === "failed" ? t("units.d2.totals.noValue") : current ? formatTotal(p, fn, value) : "…";
          const label =
            fn === "none" || !measured
              ? t("units.d2.totals.cellNone", { column: nameOf(p) })
              : t("units.d2.totals.cellLabel", { column: nameOf(p), fn: fnLabel(t, p, fn), value: shownValue });
          const isNumber = p.kind === "number";
          return (
            <div
              key={c.key}
              role="gridcell"
              aria-colindex={col + 1}
              aria-haspopup="menu"
              aria-label={col === 0 ? `${t("units.d2.totals.rowLabel")}. ${label}` : label}
              title={t("units.d2.totals.choose", { column: nameOf(p) })}
              tabIndex={tabIndexFor(row, col)}
              data-cell={`${row}:${col}`}
              data-d2-total={`${type.key}:${col}`}
              onFocus={(e) => {
                if (e.target === e.currentTarget) onFocusCell({ row, col });
              }}
              onClick={(e) => {
                if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("button")) return;
                onFocusCell({ row, col });
                openMenu(col, e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === "F2" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  openMenu(col, e.currentTarget);
                }
              }}
              style={{ width: c.width, height: ROW_HEIGHT }}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden px-3 outline-none hover:bg-line/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                isNumber && "justify-end tabular-nums",
              )}
            >
              {col === 0 ? (
                <>
                  <span aria-hidden className="shrink-0">
                    {t("units.d2.totals.rowLabel")}
                  </span>
                  {status === "failed" ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setNonce((n) => n + 1)}
                      className="shrink-0 text-[12.5px] font-medium text-danger-fg underline"
                    >
                      {t("units.d2.totals.retry")}
                    </button>
                  ) : grouped ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setGroupsOpen(true)}
                      className="shrink-0 text-[12.5px] font-medium text-brand-fg underline"
                    >
                      {t("units.d2.totals.byGroup")}
                    </button>
                  ) : null}
                </>
              ) : null}
              {fn !== "none" && measured ? (
                <span aria-hidden className={cn("truncate", col === 0 && "ml-auto")}>
                  <span className="font-normal text-muted">{fnLabel(t, p, fn)}</span> {shownValue}
                </span>
              ) : null}
              {col === 0 ? (
                <span role="status" className="sr-only">
                  {status === "failed" ? t("units.d2.totals.failed") : busy ? t("units.d2.totals.loading") : ""}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {menu !== null && menuProperty ? (
        <TotalsMenu
          place={menu.place}
          label={t("units.d2.totals.menuLabel", { column: nameOf(menuProperty) })}
          options={allowedTotals(menuProperty).map((fn) => ({
            label: fnLabel(t, menuProperty, fn),
            checked: totalFor(menuProperty, choices) === fn,
            run: () => choose(menuProperty, fn),
          }))}
          extras={[
            ...(status === "failed" ? [{ label: t("units.d2.totals.retry"), run: () => setNonce((n) => n + 1) }] : []),
            ...(grouped ? [{ label: t("units.d2.totals.byGroup"), run: () => setGroupsOpen(true) }] : []),
          ]}
          onClose={(refocus) => {
            const col = menu.col;
            setMenu(null);
            if (refocus) focusCell(col);
          }}
        />
      ) : null}

      {groupsOpen && result && state.groupBy ? (
        <GroupTotalsDialog
          title={t("units.d2.totals.byGroupTitle", { group: nameOf(properties.get(state.groupBy) ?? type.properties.find((p) => p.key === state.groupBy)!) })}
          rows={groupTotalsRows(result, columns, type.properties.find((p) => p.key === state.groupBy), locale, t("common.notSet"))}
          columns={columns.map((m) => {
            const p = properties.get(m.column)!;
            return { key: m.column, header: `${nameOf(p)} (${fnLabel(t, p, m.fn)})`, format: (v: AggregateValue) => formatTotal(p, m.fn, v), number: p.kind === "number" || m.fn.startsWith("count") };
          })}
          t={t}
          onClose={() => {
            setGroupsOpen(false);
            focusCell(0);
          }}
        />
      ) : null}

      {renaming ? (
        <RenameDialog
          property={properties.get(renaming.property) ?? null}
          original={info?.original[renaming.property] ?? null}
          locale={locale}
          t={t}
          onClose={() => {
            setRenaming(null);
            focusHeader(renaming.property);
          }}
          onSave={async (nameEn, nameFr) => {
            const answer = await renameColumnForEveryone({ type: type.key, property: renaming.property, nameEn, nameFr });
            if (!answer.ok) return answer.error ?? t("units.d2.columns.failed");
            setRenaming(null);
            focusHeader(renaming.property);
            toast(t("units.d2.columns.saved"), { tone: "success" });
            router.refresh();
            return null;
          }}
        />
      ) : null}

      {adding ? (
        <AddColumnDialog
          hidden={(info?.hidden ?? []).map((key) => {
            const p = type.properties.find((x) => x.key === key);
            return { key, name: p ? nameOf(p) : key };
          })}
          t={t}
          onClose={() => {
            setAdding(null);
            focusHeader(adding.property);
          }}
          onAdd={async (key, name) => {
            const answer = await setColumnHiddenForEveryone({ type: type.key, property: key, hidden: false });
            if (!answer.ok) return answer.error ?? t("units.d2.columns.failed");
            adding.update((s) =>
              s.columns.some((c) => c.key === key) ? s : { ...s, columns: [...s.columns, { key, width: 160, hidden: false }] },
            );
            setAdding(null);
            focusHeader(key);
            toast(t("units.d2.columns.added", { column: name }), { tone: "success" });
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

/** Stops keys, clipboard and clicks inside D2's overlays from reaching the grid's own handlers. */
const isolate = {
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  onCopy: (e: React.ClipboardEvent) => e.stopPropagation(),
  onPaste: (e: React.ClipboardEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
};

/**
 * The menu a totals cell opens: the totals this column offers (one checked),
 * then any extra actions. Fixed to the viewport above (or below) the cell, so
 * the table's scroll area never clips it.
 */
function TotalsMenu({
  place,
  label,
  options,
  extras,
  onClose,
}: {
  place: React.CSSProperties;
  label: string;
  options: { label: string; checked: boolean; run: () => void }[];
  extras: { label: string; run: () => void }[];
  onClose: (refocus: boolean) => void;
}) {
  const items = [...options.map((o) => ({ ...o, radio: true })), ...extras.map((e) => ({ ...e, checked: false, radio: false }))];
  const [active, setActive] = React.useState(() => Math.max(0, options.findIndex((o) => o.checked)));
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    refs.current[active]?.focus();
  }, [active]);

  React.useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      {...isolate}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          onClose(true);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => (a + 1) % items.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => (a - 1 + items.length) % items.length);
        } else if (e.key === "Home") {
          e.preventDefault();
          setActive(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setActive(items.length - 1);
        }
      }}
      style={{ position: "fixed", ...place }}
      className="z-(--z-overlay) max-h-[60vh] overflow-y-auto rounded-(--radius-md) border border-line bg-surface py-1 text-[13.5px] font-normal text-ink shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role={item.radio ? "menuitemradio" : "menuitem"}
          aria-checked={item.radio ? item.checked : undefined}
          tabIndex={i === active ? 0 : -1}
          onClick={() => {
            item.run();
            onClose(true);
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-soft focus:bg-surface-soft focus:outline-none",
            !item.radio && i === options.length && "border-t border-line",
          )}
        >
          <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
            {item.checked ? <Check className="size-3.5" /> : null}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function GroupTotalsDialog({
  title,
  rows,
  columns,
  t,
  onClose,
}: {
  title: string;
  rows: { key: string | null; label: string; values: Record<string, AggregateValue> }[];
  columns: { key: string; header: string; format: (v: AggregateValue) => string; number: boolean }[];
  t: LensT;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={title} className="w-[min(720px,calc(100vw-2rem))]">
      <div {...isolate} className="font-normal">
        {rows.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("units.d2.totals.noGroups")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <caption className="mb-2 text-left text-[12.5px] text-muted">{t("units.d2.totals.byGroupCaption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-2 py-1.5 text-left font-semibold">
                    {t("units.d2.totals.group")}
                  </th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={cn("px-2 py-1.5 font-semibold", c.number ? "text-right" : "text-left")}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key ?? "\u0000"} className="border-b border-line/70">
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">
                      {r.label}
                    </th>
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-2 py-1.5", c.number && "text-right tabular-nums")}>
                        {c.format(r.values[c.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("units.d2.totals.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RenameDialog({
  property,
  original,
  locale,
  t,
  onClose,
  onSave,
}: {
  property: CatalogProperty | null;
  original: { en: string; fr: string } | null;
  locale: string;
  t: LensT;
  onClose: () => void;
  onSave: (nameEn: string, nameFr: string) => Promise<string | null>;
}) {
  const [nameEn, setNameEn] = React.useState(property?.name.en ?? "");
  const [nameFr, setNameFr] = React.useState(property?.name.fr ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const enId = React.useId();
  const frId = React.useId();
  if (!property) return null;
  return (
    <Dialog open onClose={onClose} title={t("units.d2.columns.renameTitle", { column: nameIn(locale, property.name) })}>
      <form
        {...isolate}
        className="space-y-3 font-normal"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void onSave(nameEn, nameFr).then((problem) => {
            setBusy(false);
            setError(problem);
          });
        }}
      >
        <p className="text-[13px] text-muted">{t("units.d2.columns.renameHelp")}</p>
        <div className="space-y-1">
          <Label htmlFor={enId}>{t("units.d2.columns.nameEn")}</Label>
          <Input id={enId} value={nameEn} maxLength={80} required placeholder={original?.en} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={frId}>{t("units.d2.columns.nameFr")}</Label>
          <Input id={frId} value={nameFr} maxLength={80} required placeholder={original?.fr} onChange={(e) => setNameFr(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("units.d2.columns.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {t("units.d2.columns.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddColumnDialog({
  hidden,
  t,
  onClose,
  onAdd,
}: {
  hidden: { key: string; name: string }[];
  t: LensT;
  onClose: () => void;
  onAdd: (key: string, name: string) => Promise<string | null>;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onClose={onClose} title={t("units.d2.columns.addTitle")}>
      <div {...isolate} className="space-y-3 font-normal">
        {hidden.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("units.d2.columns.nothingToAdd")}</p>
        ) : (
          <>
            <p className="text-[13px] text-muted">{t("units.d2.columns.addHelp")}</p>
            <ul className="space-y-1.5">
              {hidden.map((h) => (
                <li key={h.key}>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      void onAdd(h.key, h.name).then((problem) => {
                        setBusy(false);
                        setError(problem);
                      });
                    }}
                  >
                    {t("units.d2.columns.addOne", { column: h.name })}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("units.d2.columns.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
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

/**
 * Entries D2 adds to the end of a column's header menu: for owners and
 * admins only, rename, hide (not the title) and add a column for everyone.
 * The server refuses them for anyone else whatever the menu shows.
 */
export function d2ColumnItems({ type, property, update, t }: ColumnItemsContext): ColumnMenuItem[] {
  if (!d2Info(type)?.canManage) return [];
  const send = (kind: ColumnRequest["kind"]) => () =>
    columnRequests.dispatchEvent(new CustomEvent<ColumnRequest>(REQUEST, { detail: { kind, typeKey: type.key, property: property.key, update } }));
  return [
    { label: t("units.d2.columns.rename"), run: send("rename") },
    ...(property.key !== "title" ? [{ label: t("units.d2.columns.hide"), run: send("hide") }] : []),
    { label: t("units.d2.columns.add"), run: send("add") },
  ];
}
