"use client";

import * as React from "react";
import Link from "next/link";
import { Label, Select } from "@/components/ui/input";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { findProperty, localized, type CatalogProperty } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { calendarDateInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { LensT } from "@/features/lenses/i18n";
import { formatLensValue } from "@/features/lenses/format";
import { recordHref } from "@/features/lenses/cards/cards";
import { RecordFacts } from "@/features/lenses/cards/record-facts";
import type { LayoutRenderContext, LayoutSettingsProps } from "./types";
import { coverPath, coverProperties, dateProperties, feedPath, timelinePaths } from "./d4.ids";
import { coverKey, coverTone, feedGroups, inSpan, monthTicks, nextIndex, placeBar, timelineItems, timelineSpan, type TimelineItem } from "./d4-model";

/**
 * Wave 2 unit D4 (timeline, gallery and feed layouts): how its layouts render, their settings and their
 * names. Only D4 edits this file (and d4.ids.ts).
 *
 * All three draw the rows the block already loaded (the same run, filters,
 * sort and page-local filters as the table), in the same order, and never
 * drop one: a timeline row without dates keeps its place and says so.
 * Everything is sized in percentages, so nothing scrolls sideways at 320 px.
 */

/** The body for one of this unit's layouts, or undefined when the layout is not this unit's. */
export const renderD4Layout: (ctx: LayoutRenderContext) => React.ReactNode | undefined = (ctx) => {
  if (ctx.layout === "timeline") return <TimelineLayout ctx={ctx} />;
  if (ctx.layout === "feed") return <FeedLayout ctx={ctx} />;
  if (ctx.layout === "gallery") return <GalleryLayout ctx={ctx} />;
  return undefined;
};

/** Extra settings shown in the view settings panel for this unit's layouts. */
export const D4LayoutSettings: (props: LayoutSettingsProps) => React.ReactNode = (props) => <D4Settings {...props} />;

/** The display name of one of this unit's layouts, or null when it is not this unit's. */
export const d4LayoutLabel: (layout: string, t: LayoutSettingsProps["t"]) => string | null = (layout, t) => {
  if (layout === "timeline") return t("units.d4.layouts.timeline");
  if (layout === "feed") return t("units.d4.layouts.feed");
  return null;
};

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Where a row opens: the record's own screen where it has one (as the block's other layouts do). */
function rowHref(type: string, row: LensRow): string {
  if (type === "meeting") return `/meetings/${row.id}`;
  if (type === "document") return `/documents/${row.id}`;
  return recordHref(type, row.id);
}

function dayFormatter(locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const formatDay = (fmt: Intl.DateTimeFormat, day: string) => fmt.format(new Date(`${day}T12:00:00Z`));

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-4 text-[13px] text-muted">{text}</p>;
}

function More({ ctx }: { ctx: LayoutRenderContext }) {
  const more = ctx.data.result.total - ctx.data.result.rows.length;
  return more > 0 ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">{ctx.t("view.more", { count: more })}</p> : null;
}

/** A date property of the block's type, for reading its values. */
function dateField(ctx: LayoutRenderContext, key: string | null) {
  const property = key ? findProperty(ctx.data.catalog, ctx.data.type, key) : undefined;
  return { key: property ? key : null, timestamp: Boolean(property?.timestamp), property };
}

const typeProperties = (ctx: Pick<LayoutRenderContext, "data">) => ctx.data.catalog[ctx.data.type]?.properties ?? [];

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function TimelineLayout({ ctx }: { ctx: LayoutRenderContext }) {
  const { t, locale, data, heading } = ctx;
  const { rows } = data.result;
  const hintId = React.useId();
  const links = React.useRef<(HTMLAnchorElement | null)[]>([]);
  const [focus, setFocus] = React.useState(0);
  const properties = typeProperties(ctx);
  const paths = timelinePaths(ctx.props, data.type, properties);
  const start = dateField(ctx, paths.start);
  const end = dateField(ctx, paths.end);
  // At most a few hundred rows (the block's row cap), so this is cheap on every render.
  const items = timelineItems(rows, start, end, data.timeZone);
  const span = timelineSpan(items);
  const fmt = React.useMemo(() => dayFormatter(locale), [locale]);
  const today = calendarDateInZone(new Date(), data.timeZone);
  const current = Math.min(focus, Math.max(0, items.length - 1));

  if (!start.key) return <Empty text={t("units.d4.timeline.noDateProperty")} />;
  if (rows.length === 0) return <Empty text={t("view.empty")} />;

  const describe = (item: TimelineItem) => {
    const title = item.row.title;
    if (!item.start || !item.end) return t("units.d4.timeline.noDates", { title });
    if (item.missing === "start") return t("units.d4.timeline.noStart", { title, date: formatDay(fmt, item.end) });
    if (item.missing === "end") return t("units.d4.timeline.noEnd", { title, date: formatDay(fmt, item.start) });
    if (item.start === item.end) return t("units.d4.timeline.barOne", { title, date: formatDay(fmt, item.start) });
    return t("units.d4.timeline.bar", { title, start: formatDay(fmt, item.start), end: formatDay(fmt, item.end) });
  };
  const note = (item: TimelineItem) => {
    if (!item.start || !item.end) return t("units.d4.timeline.noDatesShort");
    const range = item.start === item.end ? formatDay(fmt, item.start) : `${formatDay(fmt, item.start)} – ${formatDay(fmt, item.end)}`;
    if (item.missing === "start") return `${range} · ${t("units.d4.timeline.noStartShort")}`;
    if (item.missing === "end") return `${range} · ${t("units.d4.timeline.noEndShort")}`;
    return range;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const next = nextIndex(event.key, current, items.length);
    if (next === null) return;
    event.preventDefault();
    setFocus(next);
    links.current[next]?.focus();
  };

  const todayLeft = span && today && inSpan(span, today) ? placeBar(span, today, today).left : null;

  return (
    <div data-d4-timeline className="py-2">
      <p id={hintId} className="px-4 pb-1 text-[12px] text-muted">
        {t("units.d4.timeline.hint")}
      </p>
      {span ? (
        <div className="grid grid-cols-1 gap-x-3 px-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <p className="text-[12px] text-muted sm:col-start-2" data-d4-range>
            {t("units.d4.timeline.range", { from: formatDay(fmt, span.from), to: formatDay(fmt, span.to) })}
            {todayLeft !== null ? (
              <span className="ml-3 inline-flex items-center gap-1">
                <span aria-hidden className="inline-block h-3 w-px bg-brand/60" />
                {t("units.d4.timeline.today")}
              </span>
            ) : null}
          </p>
          <div className="relative h-5 overflow-hidden sm:col-start-2" aria-hidden>
            {/* A label too close to the right edge would be cut off; its line alone still marks the month. */}
            {monthTicks(span).map((tick) => (
              <span key={tick.day} className="absolute top-0 border-l border-line pl-1 text-[11px] whitespace-nowrap text-muted capitalize" style={{ left: `${tick.left}%` }}>
                {tick.left > 90 ? null : new Intl.DateTimeFormat(intlLocale(locale), { month: "short", timeZone: "UTC" }).format(new Date(`${tick.day}T12:00:00Z`))}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-4 text-[12.5px] text-muted">{t("units.d4.timeline.allUndated")}</p>
      )}
      <ul aria-label={t("units.d4.timeline.label", { heading })} aria-describedby={hintId} onKeyDown={onKeyDown} className="divide-y divide-line">
        {items.map((item, index) => {
          const bar = span && item.start && item.end ? placeBar(span, item.start, item.end) : null;
          return (
            <li
              key={item.row.id}
              data-view-row={item.row.id}
              data-timeline-missing={item.missing}
              className="grid grid-cols-1 items-center gap-x-3 gap-y-1 px-4 py-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <Link
                  ref={(node) => {
                    links.current[index] = node;
                  }}
                  href={rowHref(data.type, item.row)}
                  aria-label={describe(item)}
                  tabIndex={index === current ? 0 : -1}
                  onFocus={() => setFocus(index)}
                  className="block truncate text-[13px] font-medium text-ink hover:text-brand-fg"
                >
                  {item.row.title}
                </Link>
                <p className="truncate text-[11.5px] text-muted" aria-hidden>
                  {note(item)}
                </p>
              </div>
              <div className="relative h-6 overflow-hidden rounded-(--radius-sm) bg-surface-soft" aria-hidden data-timeline-track>
                {todayLeft !== null ? <span className="absolute top-0 bottom-0 w-px bg-brand/60" style={{ left: `${todayLeft}%` }} /> : null}
                {bar ? (
                  <span
                    data-timeline-bar
                    className={cn(
                      "absolute top-1 bottom-1 min-w-1.5 rounded-(--radius-sm) bg-brand",
                      item.missing === "start" && "rounded-l-none border-l-2 border-dashed border-ink/40",
                      item.missing === "end" && "rounded-r-none border-r-2 border-dashed border-ink/40",
                    )}
                    style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <More ctx={ctx} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function GalleryLayout({ ctx }: { ctx: LayoutRenderContext }) {
  const { t, locale, data, heading } = ctx;
  const { rows } = data.result;
  if (rows.length === 0) return <Empty text={t("view.empty")} />;
  const key = coverPath(ctx.props, typeProperties(ctx));
  const cover = key ? (findProperty(data.catalog, data.type, key) ?? null) : null;
  const facts = ctx.fields.filter((p) => p.key !== key);
  return (
    <>
      <ul aria-label={heading} className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <li key={row.id} data-view-card={row.id} className="card flex flex-col overflow-hidden">
            {cover ? <Cover property={cover} row={row} locale={locale} timeZone={data.timeZone} t={t} /> : null}
            <div className="flex flex-col gap-2 p-3">
              <Link href={rowHref(data.type, row)} className="text-[13.5px] leading-snug font-medium text-ink hover:text-brand-fg">
                {row.title}
              </Link>
              <RecordFacts row={row} facts={facts} locale={locale} timeZone={data.timeZone} />
            </div>
          </li>
        ))}
      </ul>
      <More ctx={ctx} />
    </>
  );
}

function Cover({ property, row, locale, timeZone, t }: { property: CatalogProperty; row: LensRow; locale: Locale; timeZone: string; t: LensT }) {
  const raw = row.values[property.key];
  const text = formatLensValue(property, raw ?? null, locale, timeZone);
  const key = coverKey(raw);
  const name = localized(property.name, locale);
  return (
    <div data-view-cover={key ?? ""} className="relative min-h-16 border-b border-line bg-surface-soft px-3 pt-4 pb-3">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: key ? `var(--color-program-dot-${coverTone(key)})` : "var(--color-line)" }}
      />
      <p className="sr-only">{text ? t("units.d4.gallery.coverLabel", { name, value: text }) : t("units.d4.gallery.coverEmpty", { name })}</p>
      <p aria-hidden className="text-[11.5px] text-muted">
        {name}
      </p>
      <p aria-hidden className={cn("truncate text-[15px] font-semibold", text ? "text-ink" : "text-muted")}>
        {text || t("common.notSet")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function FeedLayout({ ctx }: { ctx: LayoutRenderContext }) {
  const { t, locale, data, heading } = ctx;
  const { rows } = data.result;
  const date = dateField(ctx, feedPath(ctx.props, typeProperties(ctx)));
  const fmt = React.useMemo(() => dayFormatter(locale), [locale]);
  if (rows.length === 0) return <Empty text={t("view.empty")} />;
  const groups = feedGroups(rows, date, data.timeZone);
  const facts = ctx.fields.filter((p) => p.key !== date.key).slice(0, 4);
  // The day is the group's heading; a time of day (for timestamps) is the only thing left to say.
  const timeFmt = new Intl.DateTimeFormat(intlLocale(locale), { timeStyle: "short", timeZone: data.timeZone });
  const when = (row: LensRow) => {
    const raw = date.key ? row.values[date.key] : null;
    if (!date.timestamp || typeof raw !== "string") return "";
    const instant = new Date(raw);
    return Number.isNaN(instant.getTime()) ? "" : timeFmt.format(instant);
  };
  return (
    <>
      <ol aria-label={t("units.d4.feed.label", { heading })} className="divide-y divide-line" data-d4-feed>
        {groups.map((group, index) => (
          <li key={`${group.day}:${index}`} data-feed-day={group.day}>
            <h4 className="px-4 pt-3 pb-1 text-[12px] font-semibold text-muted">{group.day ? formatDay(fmt, group.day) : t("units.d4.feed.noDate")}</h4>
            <ul>
              {group.rows.map((row) => {
                const at = when(row);
                return (
                  <li key={row.id} data-view-row={row.id} className="flex flex-col gap-1 border-l-2 border-line py-2 pr-4 pl-3 ml-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link href={rowHref(data.type, row)} className="min-w-0 text-[13px] font-medium break-words text-ink hover:text-brand-fg">
                        {row.title}
                      </Link>
                      {at ? <span className="text-[11.5px] text-muted">{at}</span> : null}
                    </div>
                    <RecordFacts row={row} facts={facts} locale={locale} timeZone={data.timeZone} />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <More ctx={ctx} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type Patchable = { start?: string; end?: string; cover?: string; date?: string };

/** The stored object with one key set or removed; undefined when nothing is left. */
function patched(current: unknown, key: keyof Patchable, value: string): Patchable | undefined {
  const base = current && typeof current === "object" ? { ...(current as Patchable) } : {};
  if (value) base[key] = value;
  else delete base[key];
  return Object.keys(base).length ? base : undefined;
}

function D4Settings({ id, layout, value, onChange, catalog, type, t, locale }: LayoutSettingsProps) {
  if (layout !== "timeline" && layout !== "feed" && layout !== "gallery") return null;
  const properties = catalog[type]?.properties ?? [];
  const name = (key: string | null) => {
    const property = key ? properties.find((p) => p.key === key) : undefined;
    return property ? localized(property.name, locale) : "";
  };
  const automatic = (key: string | null) => (key ? t("units.d4.settings.automaticNamed", { name: name(key) }) : t("units.d4.settings.automatic"));
  const read = (group: string, key: keyof Patchable, allowed: readonly { key: string }[]) => {
    const stored = (value[group] as Patchable | undefined)?.[key];
    return stored && allowed.some((p) => p.key === stored) ? stored : "";
  };
  const dates = dateProperties(properties);

  if (layout === "gallery") {
    const covers = coverProperties(properties);
    return (
      <div>
        <Label htmlFor={`${id}-d4-cover`}>{t("units.d4.settings.cover")}</Label>
        <Select id={`${id}-d4-cover`} value={read("gallery", "cover", covers)} onChange={(e) => onChange({ gallery: patched(value.gallery, "cover", e.target.value) })}>
          <option value="">{t("units.d4.settings.noCover")}</option>
          {covers.map((p) => (
            <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
          ))}
        </Select>
      </div>
    );
  }

  if (!dates.length) {
    return <p className="text-[12.5px] text-muted">{t("units.d4.settings.noDates")}</p>;
  }

  if (layout === "feed") {
    const fallback = feedPath({}, properties);
    return (
      <div>
        <Label htmlFor={`${id}-d4-feed-date`}>{t("units.d4.settings.feedDate")}</Label>
        <Select id={`${id}-d4-feed-date`} value={read("feed", "date", dates)} onChange={(e) => onChange({ feed: patched(value.feed, "date", e.target.value) })}>
          <option value="">{automatic(fallback)}</option>
          {dates.map((p) => (
            <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
          ))}
        </Select>
      </div>
    );
  }

  const startFallback = timelinePaths({}, type, properties).start;
  // The end is worked out from the start in use, and can never be the start itself.
  const chosenStart = read("timeline", "start", dates);
  const effectiveStart = chosenStart || startFallback;
  const endFallback = timelinePaths({ timeline: chosenStart ? { start: chosenStart } : {} }, type, properties).end;
  const endDates = dates.filter((p) => p.key !== effectiveStart);
  return (
    <>
      <div>
        <Label htmlFor={`${id}-d4-start`}>{t("units.d4.settings.timelineStart")}</Label>
        <Select id={`${id}-d4-start`} value={chosenStart} onChange={(e) => onChange({ timeline: patched(value.timeline, "start", e.target.value) })}>
          <option value="">{automatic(startFallback)}</option>
          {dates.map((p) => (
            <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`${id}-d4-end`}>{t("units.d4.settings.timelineEnd")}</Label>
        <Select id={`${id}-d4-end`} value={read("timeline", "end", endDates)} onChange={(e) => onChange({ timeline: patched(value.timeline, "end", e.target.value) })}>
          <option value="">{endFallback ? automatic(endFallback) : t("units.d4.settings.noEnd")}</option>
          {endDates.map((p) => (
            <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
          ))}
        </Select>
      </div>
    </>
  );
}
