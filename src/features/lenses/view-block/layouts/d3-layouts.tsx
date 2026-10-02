"use client";

import * as React from "react";
import { Label, Select } from "@/components/ui/input";
import { findProperty, localized } from "@/lib/query/catalog";
import { readLocalFilters } from "../local-filters";
import { runChartBlock, type ChartRun } from "./d3-chart.actions";
import { chartData, chartIsEmpty, chartIsGrouped, chartNumberProperties, chartTotal, chartTotalOption, CHART_KINDS, readChartSettings, settingsFromTotalOption, type ChartKind } from "./d3-chart";
import { ChartFigure, chartGroupName, chartMeasureLabel } from "./d3-chart-view";
import type { LayoutRenderContext, LayoutSettingsProps } from "./types";

/**
 * Wave 2 unit D3 (charts): how its layouts render, their settings and their
 * names. Only D3 edits this file (and d3.ids.ts).
 */

/** The body for one of this unit's layouts, or undefined when the layout is not this unit's. */
export const renderD3Layout: (ctx: LayoutRenderContext) => React.ReactNode | undefined = (ctx) =>
  ctx.layout === "chart" ? <ChartLayout ctx={ctx} /> : undefined;

/** Extra settings shown in the view settings panel for this unit's layouts. */
export const D3LayoutSettings: (props: LayoutSettingsProps) => React.ReactNode = (props) =>
  props.layout === "chart" ? <ChartSettingsFields {...props} /> : null;

/** The display name of one of this unit's layouts, or null when it is not this unit's. */
export const d3LayoutLabel: (layout: string, t: LayoutSettingsProps["t"]) => string | null = (layout, t) =>
  layout === "chart" ? t("units.d3.layout") : null;

type Loaded = { forData: object; attempt: number; run: ChartRun };

/**
 * The chart layout: the view's spec totalled by lens_aggregate (a server
 * action, as the reader), drawn by ChartFigure. The block's rows are loaded
 * by the view block itself; this asks for the totals each time they change,
 * so a change of settings or page-local filters redraws the chart.
 */
function ChartLayout({ ctx, run = runChartBlock }: { ctx: LayoutRenderContext; run?: typeof runChartBlock }) {
  const { t, locale, data, props } = ctx;
  const ref = React.useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  // The block's data is a new object whenever it reloads its rows (settings, filters, retry).
  const forData: object = data;

  React.useEffect(() => {
    let live = true;
    // The reader's page-local filters live in this tab, under the block's id
    // (the view block's own attribute); the server keeps only allowed paths.
    const blockId = ref.current?.closest("[data-view-block]")?.getAttribute("data-view-block");
    const local = blockId ? readLocalFilters(window.sessionStorage, blockId) : [];
    run(props, local)
      .then((result) => {
        if (live) setLoaded({ forData, attempt, run: result });
      })
      .catch(() => {
        if (live) setLoaded({ forData, attempt, run: { ok: false, reason: "failed" } });
      });
    return () => {
      live = false;
    };
    // forData changes with every reload of the block's rows and props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forData, attempt, run]);

  const current = loaded && loaded.forData === forData && loaded.attempt === attempt ? loaded.run : null;
  const settings = readChartSettings(props.chart);
  const body = (() => {
    if (!current) {
      return (
        <p role="status" className="text-[13px] text-muted" data-chart-state="loading">
          {t("units.d3.states.loading")}
        </p>
      );
    }
    if (!current.ok) {
      return (
        <div role="alert" className="text-[13px]" data-chart-state={current.reason}>
          <p className="text-danger-fg">{t(`units.d3.states.${current.reason}`)}</p>
          {current.reason === "failed" ? (
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-1 font-medium text-brand-fg hover:underline">
              {t("units.d3.states.retry")}
            </button>
          ) : null}
        </div>
      );
    }
    const { result } = current;
    const groupProperty = result.groupBy ? findProperty(data.catalog, data.type, result.groupBy) : undefined;
    const points = chartData(result, (key, label) => chartGroupName(groupProperty, key, label, locale, data.timeZone, t));
    if (chartIsGrouped(settings.kind) && chartIsEmpty(points)) {
      return (
        <p className="text-[13px] text-muted" data-chart-state="empty">
          {t("units.d3.states.empty")}
        </p>
      );
    }
    const measureProperty = settings.property ? findProperty(data.catalog, data.type, settings.property) : undefined;
    return (
      <ChartFigure
        kind={settings.kind}
        data={points}
        total={chartTotal(result)}
        measureLabel={chartMeasureLabel(settings, measureProperty, locale, t)}
        groupLabel={groupProperty ? localized(groupProperty.name, locale) : (result.groupBy ?? "")}
        locale={locale}
        t={t}
      />
    );
  })();

  return (
    <div ref={ref} className="p-4" aria-busy={!current}>
      {body}
    </div>
  );
}

/** The chart's own settings: its kind and what it totals. It groups by the view's "Group by". */
function ChartSettingsFields({ id, value, onChange, catalog, type, t, locale }: LayoutSettingsProps) {
  const settings = readChartSettings(value.chart);
  const numbers = chartNumberProperties(catalog[type]);
  const total = chartTotalOption(settings);
  const hintId = `${id}-chart-hint`;
  return (
    <>
      <div>
        <Label htmlFor={`${id}-chart-kind`}>{t("units.d3.settings.kind")}</Label>
        <Select
          id={`${id}-chart-kind`}
          value={settings.kind}
          aria-describedby={hintId}
          onChange={(e) => onChange({ chart: { ...settings, kind: e.target.value as ChartKind } })}
        >
          {CHART_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(`units.d3.kinds.${kind}`)}</option>
          ))}
        </Select>
        <p id={hintId} className="mt-1 text-[12px] text-muted">{t("units.d3.settings.groupHint")}</p>
      </div>
      <div>
        <Label htmlFor={`${id}-chart-total`}>{t("units.d3.settings.total")}</Label>
        <Select
          id={`${id}-chart-total`}
          value={total}
          onChange={(e) => onChange({ chart: settingsFromTotalOption(settings.kind, e.target.value) })}
        >
          <option value="count">{t("units.d3.settings.count")}</option>
          {numbers.flatMap((p) =>
            (["sum", "avg"] as const).map((fn) => (
              <option key={`${fn}:${p.key}`} value={`${fn}:${p.key}`}>
                {t(`units.d3.settings.${fn}`, { property: localized(p.name, locale) })}
              </option>
            )),
          )}
        </Select>
      </div>
    </>
  );
}
