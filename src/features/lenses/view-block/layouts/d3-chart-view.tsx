"use client";

import "./d3-chart.css";
import * as React from "react";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { localized, type CatalogProperty } from "@/lib/query/catalog";
import { formatLensValue } from "@/features/lenses/format";
import type { LensT } from "@/features/lenses/i18n";
import { barLengths, chartIsGrouped, chartShares, linePoints, MAX_DRAWN_GROUPS, pieSlices, type ChartDatum, type ChartKind, type ChartSettings } from "./d3-chart";

/** What a chart's total is called: "Count", "Sum of Estimate", "Average of Estimate". */
export function chartMeasureLabel(settings: ChartSettings, property: CatalogProperty | undefined, locale: Locale, t: LensT): string {
  if (settings.total === "count") return t("units.d3.figure.count");
  const name = property ? localized(property.name, locale) : (settings.property ?? "");
  return t(`units.d3.settings.${settings.total}`, { property: name });
}

/** A group's display name, the way the view block's board and list name their groups. */
export function chartGroupName(
  property: CatalogProperty | undefined,
  key: string | null,
  label: { id: string; label: string | null } | null,
  locale: Locale,
  timeZone: string,
  t: LensT,
): string {
  if (key === null) return t("common.notSet");
  return property ? formatLensValue(property, label ?? key, locale, timeZone) || key : key;
}


export interface ChartFigureProps {
  kind: ChartKind;
  /** One datum per group (bar, line, pie). */
  data: ChartDatum[];
  /** The total over every row (single number). */
  total: number | null;
  /** What is totalled, e.g. "Count" or "Sum of Estimate". */
  measureLabel: string;
  /** The grouping property's name. */
  groupLabel: string;
  locale: Locale;
  t: LensT;
}

const LINE_W = 600;
const LINE_H = 200;

/**
 * One chart, drawn from totals already computed by lens_aggregate. The
 * drawing is decorative (aria-hidden); its text alternative is a real table
 * of the same numbers, always in the page for screen readers and shown on
 * request for everyone. Colours come from theme tokens, so it reads in light
 * and dark themes alike, and every value is also written as text.
 */
export function ChartFigure({ kind, data, total, measureLabel, groupLabel, locale, t }: ChartFigureProps) {
  const ids = React.useId();
  const [showTable, setShowTable] = React.useState(false);
  const format = React.useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }), [locale]);
  const text = (value: number | null) => (value === null ? t("units.d3.figure.noValue") : format.format(value));
  const kindName = t(`units.d3.kinds.${kind}`);
  const grouped = chartIsGrouped(kind);
  const summary = grouped
    ? t("units.d3.figure.summary", { kind: kindName, measure: measureLabel, group: groupLabel })
    : t("units.d3.figure.summaryNumber", { kind: kindName, measure: measureLabel });
  const slices = kind === "pie" ? pieSlices(data, t("units.d3.figure.other")) : [];
  const drawn = data.slice(0, MAX_DRAWN_GROUPS);
  const lengths = barLengths(drawn);
  const hidden = grouped && kind !== "pie" ? data.length - drawn.length : 0;
  const shares = kind === "pie" ? chartShares(data) : [];

  return (
    <figure data-chart={kind} aria-labelledby={`${ids}-caption`} className="m-0 space-y-3">
      <figcaption id={`${ids}-caption`} className="sr-only">
        {summary}
      </figcaption>

      <div aria-hidden="true">
        {kind === "number" ? (
          <p className="text-[32px] font-semibold leading-tight tabular-nums text-ink" data-chart-number>
            {text(total)}
          </p>
        ) : null}

        {kind === "bar" ? (
          <ul className="space-y-1.5">
            {drawn.map((d, i) => (
              <li key={d.key || `none-${i}`} data-chart-bar={d.key} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-2/5 min-w-0 truncate text-ink" title={d.label}>
                  {d.label}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="h-3 rounded-r-[4px] bg-(--color-chart-primary)" style={{ width: `${Math.max(d.value ? 1 : 0, lengths[i] * 0.8)}%` }} />
                  <span className="shrink-0 tabular-nums text-muted">{text(d.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {kind === "line" ? <LineDrawing data={drawn} text={text} /> : null}

        {kind === "pie" ? (
          <div className="flex flex-wrap items-center gap-4">
            <svg viewBox="0 0 42 42" className="size-32 shrink-0" role="presentation">
              <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--color-line)" strokeWidth="6" />
              {slices.map((s) => (
                <circle
                  key={s.key}
                  data-chart-slice={s.key}
                  cx="21"
                  cy="21"
                  r="15.9155"
                  fill="none"
                  stroke={`var(--chart-s${s.slot})`}
                  strokeWidth="6"
                  strokeDasharray={`${s.percent} ${100 - s.percent}`}
                  strokeDashoffset={25 - s.offset}
                >
                  <title>{`${s.label}: ${text(s.value)}`}</title>
                </circle>
              ))}
            </svg>
            <ul className="min-w-[8rem] flex-1 basis-[8rem] space-y-1 text-[12.5px]">
              {slices.map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--chart-s${s.slot})` }} />
                  <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {text(s.value)} · {format.format(Math.round(s.percent))}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {hidden > 0 ? <p className="text-[12px] text-muted">{t("units.d3.figure.moreGroups", { count: hidden })}</p> : null}

      <button
        type="button"
        className="text-[12.5px] font-medium text-brand-fg hover:underline"
        aria-expanded={showTable}
        aria-controls={`${ids}-table`}
        onClick={() => setShowTable((s) => !s)}
      >
        {showTable ? t("units.d3.figure.hideTable") : t("units.d3.figure.showTable")}
      </button>
      <div id={`${ids}-table`} className={cn(showTable ? "overflow-x-auto" : "sr-only")}>
        <table className="w-full text-[13px] [overflow-wrap:normal] [word-break:normal]" data-chart-table>
          <caption className="sr-only">{summary}</caption>
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-semibold">{grouped ? groupLabel : measureLabel}</th>
              <th scope="col" className="whitespace-nowrap py-1 pr-3 text-right font-semibold">{grouped ? measureLabel : t("units.d3.settings.total")}</th>
              {kind === "pie" ? <th scope="col" className="whitespace-nowrap py-1 text-right font-semibold">{t("units.d3.figure.share")}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {grouped ? (
              data.map((d, i) => {
                const percent = shares[i];
                return (
                  <tr key={d.key || `none-${i}`}>
                    <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">{d.label}</th>
                    <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{text(d.value)}</td>
                    {kind === "pie" ? <td className="whitespace-nowrap py-1 text-right tabular-nums">{`${format.format(Math.round(percent))}%`}</td> : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <th scope="row" className="py-1 pr-3 text-left font-normal text-ink">{measureLabel}</th>
                <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">{text(total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function LineDrawing({ data, text }: { data: ChartDatum[]; text: (value: number | null) => string }) {
  const points = linePoints(data, LINE_W, LINE_H);
  return (
    <div>
      <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} className="block h-auto w-full" role="presentation">
        <line x1="0" x2={LINE_W} y1={LINE_H - 12} y2={LINE_H - 12} stroke="var(--color-line)" strokeWidth="1" />
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="var(--color-chart-primary)"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle key={`${p.datum.key}-${i}`} data-chart-point={p.datum.key} cx={p.x} cy={p.y} r="6" fill="var(--color-chart-primary)" stroke="var(--color-surface)" strokeWidth="2">
            <title>{`${p.datum.label}: ${text(p.datum.value)}`}</title>
          </circle>
        ))}
      </svg>
      {data.length <= 12 ? (
        <div className="grid text-center text-[11px] text-muted" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.length)}, minmax(0, 1fr))` }}>
          {data.map((d, i) => (
            <span key={`${d.key}-${i}`} className="truncate px-0.5" title={d.label}>
              {d.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
