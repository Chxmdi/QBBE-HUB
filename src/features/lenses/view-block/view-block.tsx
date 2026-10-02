"use client";

import "./view-block.css";
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { calendarDateInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { findProperty, localized, type CatalogProperty, type LensCatalog } from "@/lib/query/catalog";
import type { LensResult, LensRow } from "@/lib/query/run";
import { RELATIVE_DATES } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";
import type { LensT } from "@/features/lenses/i18n";
import { formatLensValue } from "@/features/lenses/format";
import { recordHref } from "@/features/lenses/cards/cards";
import { RecordFacts } from "@/features/lenses/cards/record-facts";
import { TaskMeta } from "@/features/lenses/components/task-card-bits";
import { MonthGrid } from "@/features/lenses/calendar/month-grid";
import { calendarRange, monthDays, rowsToItems, shiftAnchor } from "@/features/lenses/calendar/model";
import { readLocalFilters, setLocalFilter, writeLocalFilters, type LocalFilter } from "./local-filters";
import { parseViewBlockProps, type ParsedViewBlockProps, type ViewBlockProps, type ViewLayout } from "./schema";
import { loadViewBlockOptions, runViewBlock, type ViewBlockFailure, type ViewBlockRun } from "./view-block.actions";
import { ViewConfig } from "./view-config";

type Ready = Extract<ViewBlockRun, { ok: true }>;
type State = { status: "loading" } | { status: ViewBlockFailure } | { status: "ready"; data: Ready };

const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

export interface ViewBlockComponentProps {
  /** The editor block's id; page-local filters are kept under it. */
  blockId: string;
  /** The stored props, checked here: bad ones show the invalid state. */
  config: unknown;
  editable: boolean;
  /** Stores new props; without it the block cannot be configured. */
  onChange?: (next: ViewBlockProps) => void;
  /** The data calls, replaceable in tests. */
  run?: typeof runViewBlock;
  loadOptions?: typeof loadViewBlockOptions;
}

/**
 * A generic view inside a page (U6): any type or saved lens the reader can
 * see, as a read-only table, board, list, calendar or gallery. Data comes
 * from a server action that runs `lens_query` as the reader, so rows are
 * always the reader's own. Readers can narrow it with page-local filters
 * (kept in this tab only); people who can edit the page configure it from
 * the settings panel.
 */
export function ViewBlock({ blockId, config, editable, onChange, run = runViewBlock, loadOptions = loadViewBlockOptions }: ViewBlockComponentProps) {
  const t = useLensT();
  const locale = useLocale();
  const headingId = React.useId();
  const configId = React.useId();
  const configKey = JSON.stringify(config ?? null);
  // Keyed on the serialised props, so a parent re-render with equal props
  // does not reload the block.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = React.useMemo(() => parseViewBlockProps(config), [configKey]);
  const [loaded, setLoaded] = React.useState<{ key: string; state: State } | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  // The editor renders only in the browser, so this tab's storage is there
  // on the first render. The filters belong to this reader and this tab.
  const [local, setLocal] = React.useState<LocalFilter[]>(() =>
    readLocalFilters(typeof window === "undefined" ? null : window.sessionStorage, blockId),
  );
  const [anchor, setAnchor] = React.useState(() => calendarDateInZone(new Date()) ?? new Date().toISOString().slice(0, 10));
  const [configOpen, setConfigOpen] = React.useState(false);
  const configButtonId = `${configId}-button`;
  const focusConfigButton = () => document.getElementById(configButtonId)?.focus();

  const calendar = parsed?.layout === "calendar";
  // One key per distinct request: settings, filters, calendar month, retry.
  const requestKey = JSON.stringify({ config: configKey, local, anchor: calendar ? anchor : null, attempt });
  React.useEffect(() => {
    if (!parsed) return;
    let live = true;
    const window = calendar ? calendarRange("month", anchor) : undefined;
    run(parsed, local, window)
      .then((result) => {
        if (live) setLoaded({ key: requestKey, state: result.ok ? { status: "ready", data: result } : { status: result.reason } });
      })
      .catch(() => {
        if (live) setLoaded({ key: requestKey, state: { status: "failed" } });
      });
    return () => {
      live = false;
    };
    // requestKey covers parsed, local, calendar, anchor and attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, run]);

  const busy = Boolean(parsed) && loaded?.key !== requestKey;
  // While a new request runs, rows already on screen stay; an error does not.
  const state: State = !parsed
    ? { status: "invalid" }
    : !loaded || (busy && loaded.state.status !== "ready")
      ? { status: "loading" }
      : loaded.state;

  const updateLocal = (path: string, next: LocalFilter | null) => {
    const filters = setLocalFilter(local, path, next);
    setLocal(filters);
    writeLocalFilters(window.sessionStorage, blockId, filters);
  };
  const clearLocal = () => {
    setLocal([]);
    writeLocalFilters(window.sessionStorage, blockId, []);
  };

  const data = state.status === "ready" ? state.data : null;
  const typeName = (type: string, catalog: LensCatalog) =>
    type === "task" || type === "project" ? t(`types.${type}`) : catalog[type] ? localized(catalog[type].name, locale) : type;
  const heading = parsed?.title || data?.lens?.name || (data ? typeName(data.type, data.catalog) : t("view.fallbackTitle"));
  const filterPaths = parsed && parsed.pageFilters.enabled ? parsed.pageFilters.paths : [];

  return (
    <section
      aria-labelledby={headingId}
      className="card my-3 w-full"
      data-view-block={blockId}
      data-view-layout={parsed?.layout}
      contentEditable={false}
      onKeyDown={isolateKeys}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-soft px-4 py-2.5">
        <h3 id={headingId} className="text-[13.5px] font-semibold text-ink">
          {heading}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <Link
              href={data.lens ? `/lenses/table?lens=${data.lens.id}` : `/lenses/table?type=${data.type}`}
              className="text-[12.5px] font-medium text-brand-fg hover:underline"
            >
              {t("view.openFull")}
            </Link>
          ) : null}
          {editable && onChange ? (
            <Button
              id={configButtonId}
              type="button"
              size="sm"
              variant="secondary"
              aria-expanded={configOpen}
              aria-controls={configId}
              onClick={() => setConfigOpen((open) => !open)}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              {t("view.configure")}
            </Button>
          ) : null}
        </div>
      </header>
      {configOpen && onChange ? (
        <ViewConfig
          id={configId}
          value={parsed}
          load={loadOptions}
          onApply={(next) => {
            onChange(next);
            setConfigOpen(false);
            focusConfigButton();
          }}
          onClose={() => {
            setConfigOpen(false);
            focusConfigButton();
          }}
        />
      ) : null}
      {data && filterPaths.length > 0 ? (
        <LocalFilterBar
          paths={filterPaths}
          catalog={data.catalog}
          type={data.type}
          filters={local}
          locale={locale}
          onChange={updateLocal}
          onClear={clearLocal}
        />
      ) : null}
      <div aria-live="polite" aria-busy={busy}>
        {state.status === "loading" ? <p className="px-4 py-4 text-[13px] text-muted">{t("view.loading")}</p> : null}
        {state.status === "off" || state.status === "invalid" || state.status === "missing" || state.status === "failed" ? (
          <div role="alert" className="px-4 py-4 text-[13px]">
            <p className="text-danger-fg">{t(`view.${state.status}`)}</p>
            {state.status === "failed" ? (
              <button
                type="button"
                onClick={() => setAttempt((a) => a + 1)}
                className="mt-1 font-medium text-brand-fg hover:underline"
              >
                {t("view.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        {data && parsed ? (
          <ViewBody
            layout={parsed.layout}
            data={data}
            fields={visibleFields(data.catalog, data.type, data.result, parsed)}
            locale={locale}
            t={t}
            heading={heading}
            anchor={anchor}
            onAnchor={setAnchor}
          />
        ) : null}
      </div>
    </section>
  );
}

/** The fields to show: the block's, then the lens's columns, then the type's facts, never the group or the title. */
function visibleFields(catalog: LensCatalog, type: string, result: LensResult, props: ParsedViewBlockProps): CatalogProperty[] {
  const keys = props.fields.length ? props.fields : result.columns.map((c) => c.key);
  return keys
    .filter((k) => k !== "title" && k !== result.groupBy)
    .map((k) => findProperty(catalog, type, k))
    .filter((p): p is CatalogProperty => Boolean(p && !p.filterOnly))
    .slice(0, 8);
}

/** Where a row opens: the record's own screen where it has one, else the full lens. */
function rowHref(type: string, row: LensRow): string {
  if (type === "meeting") return `/meetings/${row.id}`;
  if (type === "document") return `/documents/${row.id}`;
  return recordHref(type, row.id);
}

function RecordLink({ type, row, className }: { type: string; row: LensRow; className?: string }) {
  return (
    <Link href={rowHref(type, row)} className={cn("font-medium text-ink hover:text-brand-fg", className)}>
      {row.title}
    </Link>
  );
}

function ViewBody({
  layout,
  data,
  fields,
  locale,
  t,
  heading,
  anchor,
  onAnchor,
}: {
  layout: ViewLayout;
  data: Ready;
  fields: CatalogProperty[];
  locale: Locale;
  t: LensT;
  heading: string;
  anchor: string;
  onAnchor: (next: string) => void;
}) {
  const { result, type, catalog, timeZone } = data;
  const groupProperty = result.groupBy ? (findProperty(catalog, type, result.groupBy) ?? null) : null;
  const more = result.total - result.rows.length;
  const groupLabel = (key: string | null, label: { id: string; label: string | null } | null) =>
    key === null ? t("common.notSet") : groupProperty ? formatLensValue(groupProperty, label ?? key, locale, timeZone) || key : key;
  const facts = (row: LensRow) =>
    type === "task" ? <TaskMeta row={row} timeZone={timeZone} /> : <RecordFacts row={row} facts={fields.slice(0, 4)} locale={locale} timeZone={timeZone} />;
  const empty = <p className="px-4 py-4 text-[13px] text-muted">{t("view.empty")}</p>;

  if (layout === "calendar") {
    const today = calendarDateInZone(new Date(), timeZone) ?? anchor;
    const items = data.datePath ? rowsToItems(result.rows, type, data.datePath, new Set()) : [];
    return (
      <div className="p-3">
        <div className="mb-2 flex items-center gap-1" role="group" aria-label={t("calendar.navigation")}>
          <Button type="button" size="sm" variant="ghost" aria-label={t("view.previousMonth")} onClick={() => onAnchor(shiftAnchor("month", anchor, -1))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onAnchor(today)}>
            {t("view.today")}
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={t("view.nextMonth")} onClick={() => onAnchor(shiftAnchor("month", anchor, 1))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        {items.length === 0 ? <p className="px-1 pb-2 text-[13px] text-muted">{t("view.empty")}</p> : null}
        <MonthGrid days={monthDays(anchor)} month={anchor.slice(0, 7)} items={items} locale={locale} today={today} t={t} />
        {more > 0 ? <p className="px-1 pt-2 text-[12.5px] text-muted">{t("view.more", { count: more })}</p> : null}
      </div>
    );
  }

  if (result.rows.length === 0) return empty;

  let body: React.ReactNode;
  if (layout === "table") {
    body = (
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={heading}>
        <table className="w-full text-[13px]">
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">{t("common.type")}</th>
              {fields.map((p) => (
                <th key={p.key} scope="col" className={cn("px-3 py-2 font-semibold", p.kind === "number" && "text-right")}>
                  {localized(p.name, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.rows.map((row) => (
              <tr key={row.id} data-view-row={row.id}>
                <td className="px-4 py-2"><RecordLink type={type} row={row} /></td>
                {fields.map((p) => (
                  <td key={p.key} className={cn("px-3 py-2", p.kind === "number" && "text-right tabular-nums")}>
                    {formatLensValue(p, row.values[p.key] ?? null, locale, timeZone)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (layout === "list") {
    const sections = result.groups
      ? result.groups.map((g) => ({ key: g.key ?? "none", label: groupLabel(g.key, g.label), rows: result.rows.filter((r) => r.group === g.key) }))
      : [{ key: "all", label: null, rows: result.rows }];
    body = (
      <div>
        {sections.filter((s) => s.rows.length > 0).map((section) => (
          <section key={section.key} data-view-section={section.key}>
            {section.label !== null ? (
              <h4 className="flex items-center gap-2 border-b border-line bg-surface-soft/50 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.05em] text-ink">
                {section.label}
                <span className="font-normal text-muted">{section.rows.length}</span>
              </h4>
            ) : null}
            <ul className="divide-y divide-line">
              {section.rows.map((row) => (
                <li key={row.id} data-view-row={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                  <RecordLink type={type} row={row} />
                  <span className="meta flex flex-wrap gap-x-2">
                    {fields.map((p) => {
                      const text = formatLensValue(p, row.values[p.key] ?? null, locale, timeZone);
                      return text ? <span key={p.key}>{text}</span> : null;
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  } else if (layout === "board") {
    const groups = result.groups ?? [{ key: null, label: null, total: result.rows.length }];
    body = (
      <div className="flex gap-3 overflow-x-auto p-3" tabIndex={0} role="region" aria-label={heading}>
        {groups.map((g) => {
          const rows = result.rows.filter((r) => r.group === g.key);
          const key = g.key ?? "none";
          return (
            <section key={key} data-view-column={key} aria-label={groupLabel(g.key, g.label)} className="w-60 shrink-0 rounded-(--radius-sm) border border-line bg-surface-soft/50 p-2">
              <h4 className="mb-1.5 flex justify-between px-1 text-[12px] font-bold uppercase tracking-[0.05em] text-ink">
                <span>{groupLabel(g.key, g.label)}</span>
                <span className="text-muted">{g.total}</span>
              </h4>
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={row.id} data-view-card={row.id} className="card space-y-2 px-2.5 py-2 text-[12.5px]">
                    <RecordLink type={type} row={row} className="block leading-snug" />
                    {facts(row)}
                  </li>
                ))}
              </ul>
              {rows.length === 0 ? <p className="px-1 py-3 text-center text-[12px] text-muted">{t("board.emptyColumn")}</p> : null}
            </section>
          );
        })}
      </div>
    );
  } else {
    body = (
      <ul aria-label={heading} className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.rows.map((row) => (
          <li key={row.id} data-view-card={row.id} className="card flex flex-col gap-2 p-3">
            <RecordLink type={type} row={row} className="text-[13.5px] leading-snug" />
            <RecordFacts row={row} facts={fields} locale={locale} timeZone={timeZone} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      {body}
      {more > 0 ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">{t("view.more", { count: more })}</p> : null}
    </>
  );
}

/**
 * The reader's own filters, one control per property the block allows. They
 * change only this tab's view of the block: nothing is written to the page
 * or to the saved lens.
 */
function LocalFilterBar({
  paths,
  catalog,
  type,
  filters,
  locale,
  onChange,
  onClear,
}: {
  paths: string[];
  catalog: LensCatalog;
  type: string;
  filters: LocalFilter[];
  locale: Locale;
  onChange: (path: string, next: LocalFilter | null) => void;
  onClear: () => void;
}) {
  const t = useLensT();
  // Bumped by "Clear filters", so text fields start empty again.
  const [generation, setGeneration] = React.useState(0);
  const properties = paths.map((p) => findProperty(catalog, type, p)).filter((p): p is CatalogProperty => Boolean(p));
  if (properties.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-2" data-view-filters>
      <legend className="sr-only">{t("view.localFilters")}</legend>
      {properties.map((property) => (
        <LocalFilterControl key={`${property.key}:${generation}`} property={property} filter={filters.find((f) => f.path === property.key) ?? null} locale={locale} onChange={(next) => onChange(property.key, next)} />
      ))}
      {filters.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setGeneration((g) => g + 1);
            onClear();
          }}
        >
          {t("view.clearFilters")}
        </Button>
      ) : null}
    </fieldset>
  );
}

function LocalFilterControl({
  property,
  filter,
  locale,
  onChange,
}: {
  property: CatalogProperty;
  filter: LocalFilter | null;
  locale: Locale;
  onChange: (next: LocalFilter | null) => void;
}) {
  const t = useLensT();
  const id = React.useId();
  const name = localized(property.name, locale);
  const [text, setText] = React.useState(typeof filter?.value === "string" || typeof filter?.value === "number" ? String(filter.value) : "");
  const stored = filter?.value;
  const typed = property.kind === "number" ? (text.trim() === "" ? null : Number(text)) : text.trim() || null;
  // Compared in the stored form (trimmed text, a number), so a committed
  // filter is never committed again.
  const pending = property.kind === "text" || property.kind === "number" ? typed !== (stored ?? null) : false;
  const commit = React.useRef(onChange);
  React.useEffect(() => {
    commit.current = onChange;
  });
  React.useEffect(() => {
    if (!pending) return;
    if (typed !== null && typeof typed === "number" && !Number.isFinite(typed)) return;
    const timer = setTimeout(() => {
      if (typed === null) commit.current(null);
      else if (property.kind === "text") commit.current({ path: property.key, op: "contains", value: typed });
      else commit.current({ path: property.key, op: "eq", value: typed });
    }, 300);
    return () => clearTimeout(timer);
  }, [pending, typed, property.kind, property.key]);

  const label = <label htmlFor={id} className="mb-0.5 block text-[11.5px] font-medium text-muted">{name}</label>;
  const field = "h-8 text-[12.5px]";

  if (property.kind === "person") {
    return (
      <label className="flex min-h-8 items-center gap-2 text-[12.5px] text-ink">
        <Checkbox
          checked={Boolean(filter)}
          onChange={(event) => onChange(event.target.checked ? { path: property.key, op: "contains", value: { relative: "me" } } : null)}
        />
        {t("view.me", { name })}
      </label>
    );
  }
  if (property.kind === "select" && property.choices?.length) {
    return (
      <div className="w-44">
        {label}
        <Select id={id} className={field} value={typeof filter?.value === "string" ? filter.value : ""} onChange={(event) => onChange(event.target.value ? { path: property.key, op: "is", value: event.target.value } : null)}>
          <option value="">{t("view.any")}</option>
          {property.choices.map((choice) => (
            <option key={choice.key} value={choice.key}>{localized(choice.label, locale)}</option>
          ))}
        </Select>
      </div>
    );
  }
  if (property.kind === "date") {
    const current = filter?.value && typeof filter.value === "object" && "relative" in (filter.value as object) ? (filter.value as { relative: string }).relative : "";
    return (
      <div className="w-44">
        {label}
        <Select id={id} className={field} value={current} onChange={(event) => onChange(event.target.value ? { path: property.key, op: "is", value: { relative: event.target.value } } : null)}>
          <option value="">{t("view.anyDate")}</option>
          {RELATIVE_DATES.map((r) => (
            <option key={r} value={r}>{t(`dashboard.relative.${r}`)}</option>
          ))}
        </Select>
      </div>
    );
  }
  if (property.kind === "checkbox") {
    return (
      <div className="w-44">
        {label}
        <Select id={id} className={field} value={filter ? String(filter.value) : ""} onChange={(event) => onChange(event.target.value ? { path: property.key, op: "is", value: event.target.value === "true" } : null)}>
          <option value="">{t("view.any")}</option>
          <option value="true">{t("view.yes")}</option>
          <option value="false">{t("view.no")}</option>
        </Select>
      </div>
    );
  }
  if (property.kind === "text" || property.kind === "number") {
    return (
      <div className="w-44">
        {label}
        <Input id={id} className={field} type={property.kind === "number" ? "number" : "search"} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
    );
  }
  return null;
}
