"use client";

import * as React from "react";
import { ArrowDownUp, ChevronDown, ChevronRight, Columns3, ListFilter, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFormatters, useLocale } from "@/lib/i18n/client";
import { intlLocale } from "@/lib/i18n/config";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensGroupCount, LensResult, LensRow, LensValue } from "@/lib/query/run";
import { useLensT } from "@/features/lenses/i18n/client";
import { updateLensCell } from "@/features/lenses/services/lens.actions";
import { clearViewerSetting, saveViewerSetting } from "@/features/lenses/services/viewer-settings.actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { runLensAll } from "@/lib/query/run";
import { editorFor, type EditorKind } from "./editable";
import { formatLensValue } from "@/features/lenses/format";
import { SaveLensButton, type OpenLens } from "@/features/lenses/components/save-lens-button";
import { WhereChips } from "@/features/lenses/components/lens-chips";
import { FilterBuilder } from "@/features/lenses/filters/filter-builder";
import { countConditions, fromWhere, toWhere, type FilterGroup } from "@/features/lenses/filters/filter-model";
import { BulkEditBar, type AppliedChange } from "./bulk-edit-bar";
import {
  buildDisplayRows,
  ensureInWindow,
  groupId,
  isRef,
  MAX_ROWS,
  moveColumn,
  moveFocus,
  numberTotals,
  rawText,
  reconcileColumns,
  removeSortKey,
  resizeColumn,
  ROW_HEIGHT,
  setHidden,
  setSortKey,
  specFor,
  toggleSort,
  virtualWindow,
  visibleColumns,
  WIDTH_STEP,
  type CellPosition,
  type ColumnState,
  type DisplayRow,
  type SortKey,
  type TableState,
} from "./model";

export interface PersonOption {
  id: string;
  label: string;
}

interface Props {
  type: CatalogType;
  initial: LensResult | null;
  initialState: TableState;
  /**
   * The state of the lens itself, without the viewer's own setting; what
   * "Reset to the shared lens" goes back to. Defaults to initialState.
   */
  lensState?: TableState;
  people: PersonOption[];
  timeZone: string;
  /** The saved lens this table was opened from, if any. */
  savedLens?: OpenLens | null;
  /** Whether the wos_objects switch (bulk edit's action layer) is on. */
  bulkEditEnabled?: boolean;
}

const STORAGE_PREFIX = "qbbe-lens-table:";
const VIEWPORT_ROWS = 16;
const VIEWER_SAVE_DELAY = 600;

function readLayout(typeKey: string): ColumnState[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + typeKey);
    return raw ? (JSON.parse(raw) as ColumnState[]) : null;
  } catch {
    return null;
  }
}

function writeLayout(typeKey: string, columns: ColumnState[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + typeKey, JSON.stringify(columns));
  } catch {
    // Private windows and full storage: the layout just is not remembered.
  }
}

/** The part of the state that changes which rows the engine returns. */
function queryKey(state: TableState): string {
  return JSON.stringify([
    state.sort,
    state.groupBy,
    state.search.trim(),
    visibleColumns(state.columns).map((c) => c.key).sort(),
    state.where ?? null,
  ]);
}

/** The part of the state a viewer keeps for themselves on a shared lens. */
function viewerKey(state: TableState): string {
  return JSON.stringify([state.columns, state.sort, state.where ?? null]);
}

export function TableLens({
  type,
  initial,
  initialState,
  lensState,
  people,
  timeZone,
  savedLens = null,
  bulkEditEnabled = false,
}: Props) {
  const t = useLensT();
  const locale = useLocale();
  const format = useFormatters();
  const gridId = React.useId();
  // Someone else's shared lens: changes are kept per viewer, never on the lens.
  const perViewer = savedLens !== null && !savedLens.mine;

  const [state, setState] = React.useState<TableState>(initialState);
  const [filterTree, setFilterTree] = React.useState<FilterGroup>(() => fromWhere(initialState.where));
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [rows, setRows] = React.useState<LensRow[]>(initial?.rows ?? []);
  const [total, setTotal] = React.useState(initial?.total ?? 0);
  const [groups, setGroups] = React.useState<LensGroupCount[] | null>(initial?.groups ?? null);
  const [failed, setFailed] = React.useState(initial === null);
  const [loading, setLoading] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [focus, setFocus] = React.useState<CellPosition>({ row: 0, col: 0 });
  const [editing, setEditing] = React.useState<CellPosition | null>(null);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const [viewerMessage, setViewerMessage] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewport, setViewport] = React.useState(ROW_HEIGHT * VIEWPORT_ROWS);

  const scroller = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const requestId = React.useRef(0);
  const loadedKey = React.useRef(queryKey(initialState));
  const savedViewerKey = React.useRef(viewerKey(initialState));
  const layoutRestored = React.useRef(false);

  const properties = React.useMemo(() => new Map(type.properties.map((p) => [p.key, p])), [type]);
  const shown = visibleColumns(state.columns);
  const colCount = shown.length;

  // Restore the viewer's saved column layout once, after hydration. On a
  // shared lens the columns come from the viewer's setting instead.
  React.useEffect(() => {
    if (layoutRestored.current || perViewer) return;
    // After hydration, so the server and first client render agree. Saving
    // starts only once the saved layout has been read, or it would be
    // overwritten by the defaults.
    const timer = window.setTimeout(() => {
      const saved = readLayout(type.key);
      layoutRestored.current = true;
      if (saved) setState((s) => ({ ...s, columns: reconcileColumns(type, saved) }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [type, perViewer]);

  React.useEffect(() => {
    if (!perViewer && layoutRestored.current) writeLayout(type.key, state.columns);
  }, [type.key, state.columns, perViewer]);

  // On someone else's shared lens: keep columns, sort and filters for this
  // viewer only, a moment after they stop changing. The lens is untouched.
  React.useEffect(() => {
    if (!perViewer || !savedLens) return;
    const key = viewerKey(state);
    if (key === savedViewerKey.current) return;
    const timer = window.setTimeout(() => {
      savedViewerKey.current = key;
      void saveViewerSetting({
        lensId: savedLens.id,
        layout: { columns: state.columns },
        sort: state.sort,
        where: state.where ?? null,
      }).then((result) => {
        setViewerMessage(result.ok ? t("viewer.saved") : t("viewer.saveFailed", { reason: result.error ?? t("viewer.failed") }));
      });
    }, VIEWER_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [perViewer, savedLens, state, t]);

  // Load every page for the current query, discarding answers to stale ones.
  const load = React.useCallback(
    async (next: TableState, keepFirstPage: LensResult | null) => {
      const id = ++requestId.current;
      await Promise.resolve();
      if (id !== requestId.current) return;
      setLoading(true);
      setFailed(false);
      // Straight from the browser to the engine with the viewer's own session:
      // the engine runs under RLS, and skipping the app server halves the time
      // for thousands of rows.
      let answer: { ok: true; result: LensResult } | { ok: false };
      try {
        const client = createSupabaseBrowserClient();
        const result = keepFirstPage
          ? await runLensAll(client, specFor(type.key, next, keepFirstPage.rows.length), { timeZone, maxRows: MAX_ROWS - keepFirstPage.rows.length })
          : await runLensAll(client, specFor(type.key, next, 0), { timeZone, maxRows: MAX_ROWS });
        answer = { ok: true, result };
      } catch {
        answer = { ok: false };
      }
      if (id !== requestId.current) return;
      if (!answer.ok) {
        // A failed top-up keeps the rows already shown; a failed load says so.
        if (!keepFirstPage) setFailed(true);
        setLoading(false);
        return;
      }
      const result = answer.result;
      setRows(keepFirstPage ? [...keepFirstPage.rows, ...result.rows] : result.rows);
      setTotal(result.total);
      setGroups(result.groups);
      setLoading(false);
    },
    [type.key, timeZone],
  );

  // First render: fetch the rest of the pages beyond the server-rendered one.
  React.useEffect(() => {
    if (!initial || initial.total <= initial.rows.length) return;
    const timer = window.setTimeout(() => void load(initialState, initial), 0);
    return () => window.clearTimeout(timer);
    // Only once, for the server-rendered result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-query when sort, grouping, search, filters or the selected columns change.
  React.useEffect(() => {
    const key = queryKey(state);
    if (key === loadedKey.current) return;
    loadedKey.current = key;
    const timer = window.setTimeout(() => void load(state, null), 250);
    return () => window.clearTimeout(timer);
  }, [state, load]);

  // Track the viewport for the virtual window.
  React.useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const groupLabel = React.useCallback(
    (group: LensGroupCount): string => {
      if (group.key === null) return t("common.notSet");
      if (group.label) return group.label.label ?? t("common.notSet");
      const p = state.groupBy ? properties.get(state.groupBy) : undefined;
      return (p && rawText(p, group.key, locale)) ?? group.key;
    },
    [locale, properties, state.groupBy, t],
  );

  const display: DisplayRow[] = React.useMemo(
    () => buildDisplayRows(rows, state.groupBy ? groups : null, groupLabel, collapsed),
    [rows, groups, groupLabel, collapsed, state.groupBy],
  );
  const totals = React.useMemo(() => numberTotals(rows, type.properties), [rows, type.properties]);
  const hasTotals = shown.some((c) => properties.get(c.key)?.kind === "number");

  // Grid rows: header (0), display rows (1..n), totals (n+1) when present.
  const gridRows = 1 + display.length + (hasTotals ? 1 : 0);
  const pageRows = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);

  let window_ = virtualWindow(scrollTop, viewport, display.length);
  if (focus.row >= 1 && focus.row <= display.length) {
    window_ = ensureInWindow(focus.row - 1, window_, display.length);
  }

  // Keep focus on the active cell after re-renders that moved it.
  const focusCell = React.useCallback((pos: CellPosition) => {
    const grid = gridRef.current;
    if (!grid) return;
    const cell = grid.querySelector<HTMLElement>(`[data-cell="${pos.row}:${pos.col}"]`)
      ?? grid.querySelector<HTMLElement>(`[data-cell="${pos.row}:0"]`);
    cell?.focus({ preventScroll: false });
  }, []);

  // Focus to restore after the next render (a move, or leaving an editor).
  const pendingFocusRef = React.useRef<CellPosition | null>(null);
  const setPendingFocus = (pos: CellPosition | null) => {
    pendingFocusRef.current = pos;
  };
  React.useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (!pendingFocus) return;
    const element = scroller.current;
    if (element && pendingFocus.row >= 1 && pendingFocus.row <= display.length) {
      const top = (pendingFocus.row - 1) * ROW_HEIGHT;
      const headerHeight = ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight - headerHeight) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight + headerHeight * 2;
      }
    }
    focusCell(pendingFocus);
    pendingFocusRef.current = null;
  });

  const moveTo = (pos: CellPosition) => {
    setFocus(pos);
    setPendingFocus(pos);
  };

  const update = (change: (s: TableState) => TableState) => setState((s) => change(s));

  const property = (col: number): CatalogProperty | undefined => {
    const c = shown[col];
    return c ? properties.get(c.key) : undefined;
  };

  // --- Filters -------------------------------------------------------------

  const changeFilters = (next: FilterGroup) => {
    setFilterTree(next);
    const where = toWhere(next, type) ?? null;
    update((s) => (JSON.stringify(s.where ?? null) === JSON.stringify(where) ? s : { ...s, where }));
  };
  const filterCount = countConditions(filterTree);

  const resetToLens = () => {
    if (!savedLens) return;
    const base = lensState ?? initialState;
    void clearViewerSetting(savedLens.id).then((result) => {
      if (!result.ok) {
        setViewerMessage(result.error ?? t("viewer.failed"));
        return;
      }
      savedViewerKey.current = viewerKey(base);
      setState(base);
      setFilterTree(fromWhere(base.where));
      setViewerMessage(t("viewer.resetDone"));
    });
  };

  // --- Selection and bulk edit ----------------------------------------------

  const recordIds = React.useMemo(() => display.filter((d) => d.kind === "record").map((d) => (d as { row: LensRow }).row.id), [display]);
  const selectedVisible = recordIds.filter((id) => selected.has(id));
  const allSelected = recordIds.length > 0 && selectedVisible.length === recordIds.length;

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(recordIds));

  const applyBulk = (change: AppliedChange) => {
    const ids = new Set(change.ids);
    setRows((current) =>
      current.map((r) =>
        ids.has(r.id)
          ? change.property === "title"
            ? { ...r, title: String(change.value ?? "") }
            : { ...r, values: { ...r.values, [change.property]: change.value } }
          : r,
      ),
    );
    setAnnouncement(change.changed === 1 ? t("bulk.appliedOne") : t("bulk.applied", { count: change.changed }));
  };

  const undoneBulk = () => {
    setAnnouncement(t("bulk.undone"));
    void load(state, null);
  };

  // --- Editing -------------------------------------------------------------

  const valueOf = (row: LensRow, key: string): LensValue => (key === "title" ? row.title : row.values[key] ?? null);

  const startEdit = (pos: CellPosition) => {
    const item = display[pos.row - 1];
    const p = property(pos.col);
    if (!item || item.kind !== "record" || !p) return;
    if (!editorFor(type.key, p.key)) {
      setAnnouncement(t("table.readOnly"));
      return;
    }
    setEditing(pos);
  };

  const commit = async (row: LensRow, key: string, next: LensValue, raw: string | null) => {
    const before = valueOf(row, key);
    setEditing(null);
    setPendingFocus(focus);
    const same = isRef(before) && isRef(next) ? before.id === next.id : before === next;
    if (same) return;
    const apply = (value: LensValue) =>
      setRows((current) =>
        current.map((r) =>
          r.id !== row.id
            ? r
            : key === "title"
              ? { ...r, title: String(value ?? "") }
              : { ...r, values: { ...r.values, [key]: value } },
        ),
      );
    apply(next);
    const result = await updateLensCell({ type: type.key, id: row.id, property: key, value: raw });
    if (result.ok) {
      setAnnouncement(t("table.saved"));
    } else {
      apply(before);
      setAnnouncement(t("table.saveFailed", { reason: result.error ?? t("common.loadFailed") }));
    }
  };

  // --- Keyboard ------------------------------------------------------------

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const target = event.target as HTMLElement;
    if (!target.dataset.cell) return;
    const header = focus.row === 0;
    const p = property(focus.col);

    if (header && p && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const width = shown[focus.col].width + (event.key === "ArrowRight" ? WIDTH_STEP : -WIDTH_STEP);
      update((s) => ({ ...s, columns: resizeColumn(s.columns, p.key, width) }));
      return;
    }
    if (event.key === " " && !header) {
      // Space selects or clears the focused row for a bulk edit.
      const item = display[focus.row - 1];
      if (item?.kind === "record") {
        event.preventDefault();
        toggleSelected(item.row.id);
        return;
      }
    }
    if (event.key === "Enter" || event.key === "F2" || (event.key === " " && header)) {
      event.preventDefault();
      if (header && p) setMenuFor(p.key);
      else {
        const item = display[focus.row - 1];
        if (item?.kind === "group") toggleGroup(item.key);
        else if (item) startEdit(focus);
      }
      return;
    }
    const next = moveFocus(focus, event.key, { ctrl: event.ctrlKey || event.metaKey }, { rows: gridRows, cols: colCount, pageRows });
    if (next) {
      event.preventDefault();
      moveTo(next);
    }
  };

  const toggleGroup = (key: string | null) => {
    setCollapsed((current) => {
      const next = new Set(current);
      const id = groupId(key);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // --- Column resizing by pointer ------------------------------------------

  const startResize = (event: React.PointerEvent, key: string, width: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const onMove = (e: PointerEvent) =>
      update((s) => ({ ...s, columns: resizeColumn(s.columns, key, width + e.clientX - startX) }));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // --- Rendering -----------------------------------------------------------

  const totalWidth = shown.reduce((sum, c) => sum + c.width, 0);
  const typeName = t(`types.${type.key}` as "types.task") || type.name.en;
  const collator = React.useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }), [locale]);

  const cellText = (p: CatalogProperty, value: LensValue): string => formatLensValue(p, value, locale, timeZone);

  const tabIndexFor = (row: number, col: number) => (focus.row === row && focus.col === col ? 0 : -1);

  const nameOf = (p: CatalogProperty) => (locale.startsWith("fr") ? p.name.fr : p.name.en);

  const sortIndex = (key: string): number => state.sort.findIndex((k) => k.property === key);
  const sortState = (key: string): "ascending" | "descending" | "none" => {
    const k = state.sort.find((s) => s.property === key);
    return k ? (k.direction === "asc" ? "ascending" : "descending") : "none";
  };
  const directionLabel = (k: SortKey) => (k.direction === "asc" ? t("sort.ascending") : t("sort.descending"));

  const groupable = type.properties.filter((p) => p.groupable);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
          {t("table.search")}
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={state.search}
              maxLength={200}
              onChange={(e) => update((s) => ({ ...s, search: e.target.value }))}
              className="h-9 w-64 rounded-(--radius-sm) border border-line bg-surface pl-8 pr-3 text-[14px] text-ink"
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink">
          {t("table.groupBy")}
          <Select
            value={state.groupBy ?? ""}
            onChange={(e) => update((s) => ({ ...s, groupBy: e.target.value || null }))}
            className="h-9! w-auto! px-2! text-[14px]!"
          >
            <option value="">{t("table.noGrouping")}</option>
            {groupable.map((p) => (
              <option key={p.key} value={p.key}>
                {nameOf(p)}
              </option>
            ))}
          </Select>
        </label>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={`${gridId}-filters`}
          onClick={() => setFiltersOpen((o) => !o)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-soft",
            filterCount > 0 && "border-brand/40 text-brand-fg",
          )}
        >
          <ListFilter className="size-4" aria-hidden />
          {filterCount > 0 ? t("filters.toggleCount", { count: filterCount }) : t("filters.toggle")}
        </button>
        <div className="relative">
          <button
            type="button"
            aria-expanded={columnsOpen}
            aria-controls={`${gridId}-columns`}
            onClick={() => setColumnsOpen((o) => !o)}
            className="inline-flex h-9 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-soft"
          >
            <Columns3 className="size-4" aria-hidden />
            {t("table.columns")}
          </button>
          {columnsOpen ? (
            <fieldset
              id={`${gridId}-columns`}
              className="absolute left-0 z-(--z-overlay) mt-1 w-64 rounded-(--radius-md) border border-line bg-surface p-3 shadow-lg"
              onKeyDown={(e) => {
                if (e.key === "Escape") setColumnsOpen(false);
              }}
            >
              <legend className="sr-only">{t("table.columnsLabel")}</legend>
              {state.columns.map((c) => {
                const p = properties.get(c.key);
                if (!p) return null;
                return (
                  <label key={c.key} className="flex items-center gap-2 py-1 text-[13.5px] text-ink">
                    <Checkbox
                      checked={!c.hidden}
                      disabled={c.key === "title"}
                      onChange={(e) => update((s) => ({ ...s, columns: setHidden(s.columns, c.key, !e.target.checked) }))}
                    />
                    {nameOf(p)}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
        </div>
        <SaveLensButton
          kind="table"
          current={savedLens}
          basePath="/lenses/table"
          read={() => ({ spec: { ...specFor(type.key, { ...state, search: "" }), offset: 0 }, layout: { columns: state.columns } })}
        />
        {perViewer ? (
          <Button type="button" size="sm" variant="ghost" onClick={resetToLens}>
            {t("viewer.reset")}
          </Button>
        ) : null}
        <p className="ml-auto text-[13px] text-muted" aria-live="polite">
          {loading && rows.length < Math.min(total, MAX_ROWS)
            ? t("common.loadingMore")
            : total === 1
              ? t("common.rowsOne")
              : t("common.rows", { count: format.number(total) })}
        </p>
      </div>

      {filtersOpen ? (
        <div id={`${gridId}-filters`} className="mb-3">
          <FilterBuilder type={type} value={filterTree} onChange={changeFilters} people={people} locale={locale} onDone={() => setFiltersOpen(false)} />
        </div>
      ) : (
        <WhereChips where={state.where ?? null} type={type} locale={locale} people={people} className="mb-3" />
      )}

      {state.sort.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
          <ArrowDownUp className="size-4 text-muted" aria-hidden />
          <ul aria-label={t("sort.chips")} className="flex flex-wrap items-center gap-2">
            {state.sort.map((k, index) => {
              const p = properties.get(k.property);
              const name = p ? nameOf(p) : k.property;
              return (
                <li key={k.property} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface">
                  <button
                    type="button"
                    aria-label={t("sort.toggle", { name })}
                    onClick={() => update((s) => ({ ...s, sort: toggleSort(s.sort, k.property, true) }))}
                    className="px-2.5 py-1 font-medium text-ink hover:bg-surface-soft"
                  >
                    {t("sort.chip", { index: index + 1, name, direction: directionLabel(k) })}
                  </button>
                  <button
                    type="button"
                    aria-label={t("sort.remove", { name })}
                    onClick={() => update((s) => ({ ...s, sort: removeSortKey(s.sort, k.property) }))}
                    className="inline-flex size-6 items-center justify-center text-muted hover:bg-surface-soft hover:text-ink"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => update((s) => ({ ...s, sort: [] }))} className="text-muted hover:text-ink hover:underline">
            {t("sort.clearAll")}
          </button>
        </div>
      ) : null}

      <BulkEditBar
        type={type}
        people={people}
        locale={locale}
        enabled={bulkEditEnabled}
        selectedIds={selectedVisible}
        onClear={() => setSelected(new Set())}
        onApplied={applyBulk}
        onUndone={undoneBulk}
      />

      <p id={`${gridId}-hint`} className="sr-only">
        {t("table.editHint")} {t("bulk.hint")}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {perViewer ? (
        <p role="status" aria-live="polite" className={cn("text-[12.5px] text-muted", !viewerMessage && "sr-only")}>
          {viewerMessage}
        </p>
      ) : null}

      {failed ? (
        <div role="alert" className="rounded-(--radius-md) border border-danger/25 bg-danger/10 px-4 py-3">
          <p className="text-[13.5px] font-medium text-danger-fg">{t("common.loadFailed")}</p>
          <p className="mt-0.5 text-[13px] text-muted">{t("common.loadFailedDetail")}</p>
          <button
            type="button"
            onClick={() => void load(state, null)}
            className="mt-2 text-[13px] font-medium text-brand-fg hover:underline"
          >
            {t("common.tryAgain")}
          </button>
        </div>
      ) : (
        <div
          ref={scroller}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="card relative max-h-[70vh] overflow-auto"
          style={{ height: Math.min(ROW_HEIGHT * (gridRows + 1), ROW_HEIGHT * (VIEWPORT_ROWS + 2)) }}
        >
          <div
            ref={gridRef}
            role="grid"
            aria-label={t("table.gridLabel", { type: typeName })}
            aria-describedby={`${gridId}-hint`}
            aria-rowcount={gridRows}
            aria-colcount={colCount}
            aria-multiselectable
            onKeyDown={onGridKeyDown}
            style={{ width: totalWidth, minWidth: "100%" }}
            className="text-[13.5px] text-ink"
          >
            <div role="rowgroup" className="sticky top-0 z-(--z-raised) bg-surface-soft">
              <div role="row" aria-rowindex={1} className="flex border-b border-line">
                {shown.map((c, col) => {
                  const p = properties.get(c.key)!;
                  const name = nameOf(p);
                  const sort = sortState(c.key);
                  const index = sortIndex(c.key);
                  return (
                    <div
                      key={c.key}
                      role="columnheader"
                      aria-colindex={col + 1}
                      aria-sort={sort}
                      tabIndex={tabIndexFor(0, col)}
                      data-cell={`0:${col}`}
                      onFocus={() => setFocus({ row: 0, col })}
                      onClick={(e) => {
                        setFocus({ row: 0, col });
                        // A click sorts by this column (Shift adds it as a later key); the chevron opens the menu.
                        if (p.sortable) update((s) => ({ ...s, sort: toggleSort(s.sort, c.key, e.shiftKey) }));
                        else setMenuFor(menuFor === c.key ? null : c.key);
                      }}
                      style={{ width: c.width, height: ROW_HEIGHT }}
                      className="relative flex shrink-0 cursor-pointer select-none items-center gap-1 px-3 font-semibold text-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                    >
                      {c.key === "title" ? (
                        <Checkbox
                          aria-label={t("bulk.selectAll")}
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !allSelected && selectedVisible.length > 0;
                          }}
                          tabIndex={-1}
                          onClick={(e) => e.stopPropagation()}
                          onChange={toggleAll}
                          className="mr-1"
                        />
                      ) : null}
                      <span className="truncate">{name}</span>
                      {sort !== "none" ? (
                        <span aria-hidden className="shrink-0">
                          {sort === "ascending" ? "↑" : "↓"}
                          {state.sort.length > 1 ? <sup>{index + 1}</sup> : null}
                        </span>
                      ) : null}
                      <span
                        role="presentation"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocus({ row: 0, col });
                          setMenuFor(menuFor === c.key ? null : c.key);
                        }}
                        className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-line/60"
                      >
                        <ChevronDown className="size-3.5" aria-hidden />
                      </span>
                      <span
                        aria-hidden
                        onPointerDown={(e) => startResize(e, c.key, c.width)}
                        onClick={(e) => e.stopPropagation()}
                        title={t("table.resize", { name })}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-brand/40"
                      />
                      {menuFor === c.key ? (
                        <ColumnMenu
                          label={t("table.columnMenu", { name })}
                          items={[
                            ...(p.sortable
                              ? [
                                  { label: t("table.sortAsc"), run: () => update((s) => ({ ...s, sort: setSortKey(s.sort, { property: c.key, direction: "asc" }, false) })) },
                                  { label: t("table.sortDesc"), run: () => update((s) => ({ ...s, sort: setSortKey(s.sort, { property: c.key, direction: "desc" }, false) })) },
                                ]
                              : []),
                            ...(p.sortable && state.sort.length > 0 && !(state.sort.length === 1 && index === 0)
                              ? [
                                  { label: t("sort.thenAsc"), run: () => update((s) => ({ ...s, sort: setSortKey(s.sort, { property: c.key, direction: "asc" }, true) })) },
                                  { label: t("sort.thenDesc"), run: () => update((s) => ({ ...s, sort: setSortKey(s.sort, { property: c.key, direction: "desc" }, true) })) },
                                ]
                              : []),
                            ...(index >= 0 ? [{ label: t("table.clearSort"), run: () => update((s) => ({ ...s, sort: removeSortKey(s.sort, c.key) })) }] : []),
                            ...(p.groupable ? [{ label: t("table.groupByThis"), run: () => update((s) => ({ ...s, groupBy: c.key })) }] : []),
                            ...(c.key !== "title"
                              ? [
                                  { label: t("table.moveLeft"), run: () => update((s) => ({ ...s, columns: moveColumn(s.columns, c.key, -1) })) },
                                  { label: t("table.moveRight"), run: () => update((s) => ({ ...s, columns: moveColumn(s.columns, c.key, 1) })) },
                                ]
                              : []),
                            { label: t("table.wider"), run: () => update((s) => ({ ...s, columns: resizeColumn(s.columns, c.key, c.width + WIDTH_STEP) })) },
                            { label: t("table.narrower"), run: () => update((s) => ({ ...s, columns: resizeColumn(s.columns, c.key, c.width - WIDTH_STEP) })) },
                            ...(c.key !== "title" ? [{ label: t("table.hide"), run: () => update((s) => ({ ...s, columns: setHidden(s.columns, c.key, true) })) }] : []),
                          ]}
                          onClose={() => {
                            setMenuFor(null);
                            setPendingFocus({ row: 0, col: Math.min(col, visibleColumns(state.columns).length - 1) });
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div role="rowgroup">
              {display.length === 0 && !loading ? (
                <div role="row" aria-rowindex={2} className="flex">
                  <div role="gridcell" aria-colindex={1} className="px-3 py-3 text-muted" style={{ width: totalWidth }}>
                    {t("common.empty")}
                  </div>
                </div>
              ) : null}
              <div style={{ height: window_.start * ROW_HEIGHT }} aria-hidden />
              {display.slice(window_.start, window_.end).map((item, offset) => {
                const index = window_.start + offset;
                const gridRow = index + 1;
                if (item.kind === "group") {
                  const label = item.label;
                  return (
                    <div key={`g:${groupId(item.key)}`} role="row" aria-rowindex={gridRow + 1} className="flex border-b border-line bg-canvas">
                      <div
                        role="gridcell"
                        aria-colindex={1}
                        aria-colspan={colCount}
                        aria-expanded={!item.collapsed}
                        tabIndex={focus.row === gridRow ? 0 : -1}
                        data-cell={`${gridRow}:0`}
                        onFocus={() => setFocus((f) => ({ row: gridRow, col: f.row === gridRow ? f.col : 0 }))}
                        onClick={() => toggleGroup(item.key)}
                        style={{ width: totalWidth, height: ROW_HEIGHT }}
                        className="flex cursor-pointer items-center gap-1.5 px-3 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                        aria-label={`${t("table.groupRow", { label, count: item.count })}. ${item.collapsed ? t("table.expand", { label }) : t("table.collapse", { label })}`}
                      >
                        {item.collapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                        <span>{label}</span>
                        <span className="text-muted">{item.count}</span>
                      </div>
                    </div>
                  );
                }
                const row = item.row;
                const isSelected = selected.has(row.id);
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-rowindex={gridRow + 1}
                    aria-selected={isSelected}
                    className={cn("flex border-b border-line/70 hover:bg-surface-soft/60", isSelected && "bg-brand/5")}
                  >
                    {shown.map((c, col) => {
                      const p = properties.get(c.key)!;
                      const value = valueOf(row, c.key);
                      const editor = editorFor(type.key, c.key);
                      const isEditing = editing?.row === gridRow && editing.col === col;
                      const text = cellText(p, value);
                      return (
                        <div
                          key={c.key}
                          role="gridcell"
                          aria-colindex={col + 1}
                          aria-readonly={editor ? undefined : true}
                          tabIndex={isEditing ? -1 : tabIndexFor(gridRow, col)}
                          data-cell={`${gridRow}:${col}`}
                          onFocus={(e) => {
                            if (e.target === e.currentTarget) setFocus({ row: gridRow, col });
                          }}
                          onDoubleClick={() => startEdit({ row: gridRow, col })}
                          style={{ width: c.width, height: ROW_HEIGHT }}
                          className={cn(
                            "flex shrink-0 items-center overflow-hidden px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                            p.kind === "number" && "justify-end tabular-nums",
                            c.key === "title" && "font-medium",
                          )}
                        >
                          {c.key === "title" && !isEditing ? (
                            <Checkbox
                              aria-label={t("bulk.selectRow", { title: row.title })}
                              checked={isSelected}
                              tabIndex={-1}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onChange={() => toggleSelected(row.id)}
                              className="mr-2"
                            />
                          ) : null}
                          {isEditing && editor ? (
                            <CellEditor
                              kind={editor}
                              property={p}
                              value={value}
                              people={people}
                              locale={locale}
                              label={t("table.edit", { name: nameOf(p) })}
                              notSet={t("common.notSet")}
                              onCancel={() => {
                                setEditing(null);
                                setPendingFocus({ row: gridRow, col });
                              }}
                              onCommit={(next, raw) => void commit(row, c.key, next, raw)}
                            />
                          ) : (
                            <span className={cn("truncate", !text && "text-muted")}>{text}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ height: (display.length - window_.end) * ROW_HEIGHT }} aria-hidden />
            </div>

            {hasTotals ? (
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
                        onFocus={() => setFocus({ row: gridRows - 1, col })}
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
            ) : null}
          </div>
        </div>
      )}
      {rows.length >= MAX_ROWS && total > MAX_ROWS ? (
        <p className="mt-2 text-[13px] text-muted">{t("common.rows", { count: `${format.number(MAX_ROWS)} / ${format.number(total)}` })}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ColumnMenu({
  label,
  items,
  onClose,
}: {
  label: string;
  items: { label: string; run: () => void }[];
  onClose: () => void;
}) {
  const [active, setActive] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  React.useEffect(() => {
    refs.current[active]?.focus();
  }, [active]);
  return (
    <div
      role="menu"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          onClose();
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
      className="absolute left-0 top-full z-(--z-overlay) mt-1 min-w-48 rounded-(--radius-md) border border-line bg-surface py-1 font-normal text-ink shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={i === active ? 0 : -1}
          onClick={() => {
            item.run();
            onClose();
          }}
          className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-surface-soft focus:bg-surface-soft focus:outline-none"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function CellEditor({
  kind,
  property,
  value,
  people,
  locale,
  label,
  notSet,
  onCommit,
  onCancel,
}: {
  kind: EditorKind;
  property: CatalogProperty;
  value: LensValue;
  people: PersonOption[];
  locale: string;
  label: string;
  notSet: string;
  onCommit: (next: LensValue, raw: string | null) => void;
  onCancel: () => void;
}) {
  const initial = isRef(value) ? value.id : value === null || value === undefined ? "" : String(value).slice(0, kind === "date" ? 10 : undefined);
  const [draft, setDraft] = React.useState(initial);
  const done = React.useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const raw = draft.trim() === "" ? null : draft.trim();
    if (kind === "text" && raw === null) return onCancel();
    if (kind === "person") {
      const person = people.find((p) => p.id === raw);
      return onCommit(person ? { id: person.id, label: person.label } : null, raw);
    }
    if (kind === "select" && raw === null) return onCancel();
    onCommit(raw, raw);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  const common = {
    "aria-label": label,
    autoFocus: true,
    onKeyDown,
    onBlur: finish,
    className: "h-7! w-full rounded-(--radius-sm) border border-brand! bg-surface px-1.5! text-[13.5px]! text-ink",
  };

  if (kind === "select") {
    return (
      <Select {...common} value={draft} onChange={(e) => setDraft(e.target.value)}>
        {(property.choices ?? []).map((c) => (
          <option key={c.key} value={c.key}>
            {locale.startsWith("fr") ? c.label.fr : c.label.en}
          </option>
        ))}
      </Select>
    );
  }
  if (kind === "person") {
    return (
      <Select {...common} value={draft} onChange={(e) => setDraft(e.target.value)}>
        <option value="">{notSet}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <input
      {...common}
      type={kind === "date" ? "date" : "text"}
      maxLength={kind === "text" ? 300 : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
