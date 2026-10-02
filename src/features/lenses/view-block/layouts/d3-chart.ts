import { z } from "zod";
import type { AggregateMeasure, AggregateResult, AggregateValue } from "@/lib/query/aggregate";
import type { CatalogType } from "@/lib/query/catalog";
import type { LensSpec } from "@/lib/query/spec";

/**
 * Wave 2 unit D3: charts. The settings a chart stores (in a view block's
 * `chart` prop and in a dashboard chart tile), the totals it asks
 * `lens_aggregate` for, and the pure geometry its figures draw. No React, so
 * the view block's schema and the dashboard's schema can both import it.
 *
 * A chart never counts rows itself: every number comes from lens_aggregate,
 * which runs as the viewer, so a chart only ever counts rows they can open.
 */

export const CHART_KINDS = ["bar", "line", "pie", "number"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export const CHART_TOTALS = ["count", "sum", "avg"] as const;
export type ChartTotal = (typeof CHART_TOTALS)[number];

/** How many slices a pie shows before the rest fold into "Other" (the palette has eight hues). */
export const PIE_SLICES = 8;
/** How many groups a bar or line chart draws; the data table always lists every group. */
export const MAX_DRAWN_GROUPS = 30;

const propertyRef = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Unknown property");

export const chartSettingsSchema = z
  .object({
    kind: z.enum(CHART_KINDS).default("bar"),
    total: z.enum(CHART_TOTALS).default("count"),
    property: propertyRef.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.total !== "count" && !value.property) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A sum or an average needs a number property.", path: ["property"] });
    }
    if (value.total === "count" && value.property) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A count takes no property.", path: ["property"] });
    }
    // A pie shows parts of a whole; averages are not parts of anything.
    if (value.kind === "pie" && value.total === "avg") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A pie chart shows a count or a sum.", path: ["total"] });
    }
  });
export type ChartSettings = z.output<typeof chartSettingsSchema>;
export type ChartSettingsInput = z.input<typeof chartSettingsSchema>;

export const DEFAULT_CHART: ChartSettings = { kind: "bar", total: "count" };

/** The stored settings, or the defaults when there are none or they do not parse. */
export function readChartSettings(input: unknown): ChartSettings {
  if (input === undefined || input === null) return DEFAULT_CHART;
  const parsed = chartSettingsSchema.safeParse(input);
  return parsed.success ? parsed.data : DEFAULT_CHART;
}

/** The one total a chart asks lens_aggregate for (measure id "m0"). */
export function chartMeasures(settings: ChartSettings): AggregateMeasure[] {
  if (settings.total === "count") return [{ fn: "count" }];
  return [{ fn: settings.total, property: settings.property! }];
}

/** Whether the chart draws one figure per group (every kind but a single number). */
export const chartIsGrouped = (kind: ChartKind) => kind !== "number";

/** The number properties of a type a chart can sum or average. */
export function chartNumberProperties(type: CatalogType | undefined) {
  return (type?.properties ?? []).filter((p) => p.kind === "number" && !p.filterOnly);
}

export type ChartSpecProblem = "needsGroup" | "invalid";

/**
 * The spec a chart totals: the view's own spec (filters and all) with the
 * grouping the chart needs. A single number drops the grouping; a grouped
 * chart keeps the view's, or falls back to `fallbackGroup` when the type has
 * it. Sort, columns and paging do not change a total, so they go.
 */
export function chartSpec(spec: LensSpec, settings: ChartSettings, type: CatalogType, fallbackGroup?: string): LensSpec | ChartSpecProblem {
  if (settings.total !== "count" && !chartNumberProperties(type).some((p) => p.key === settings.property)) return "invalid";
  const rest: LensSpec = { version: spec.version, type: spec.type, ...(spec.where ? { where: spec.where } : {}) };
  if (!chartIsGrouped(settings.kind)) return rest;
  const groupBy = spec.groupBy;
  const groupable = (key: string | undefined) => Boolean(key && type.properties.some((p) => p.key === key && p.groupable && !p.filterOnly));
  // The view's own grouping when it has one (and it must be usable); the type's default only when it has none.
  const key = groupBy?.property ? (groupable(groupBy.property) ? groupBy.property : undefined) : groupable(fallbackGroup) ? fallbackGroup : undefined;
  if (!key) return "needsGroup";
  return { ...rest, groupBy: { property: key } };
}

/** A total as a number to draw, or null when there is nothing to draw (no rows, none filled). */
export function chartNumber(value: AggregateValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface ChartDatum {
  key: string;
  label: string;
  value: number | null;
}

/** One datum per group, in the engine's order, labelled by `label`. */
export function chartData(
  result: Pick<AggregateResult, "groups">,
  label: (key: string | null, groupLabel: { id: string; label: string | null } | null) => string,
): ChartDatum[] {
  return (result.groups ?? []).map((g) => ({ key: g.key ?? "", label: label(g.key, g.label), value: chartNumber(g.totals.m0) }));
}

/** Nothing to chart: no groups, or every group's total is empty. */
export function chartIsEmpty(data: ChartDatum[]): boolean {
  return data.length === 0 || data.every((d) => d.value === null);
}

/** Each bar's length as a percentage of the longest (by magnitude). */
export function barLengths(data: ChartDatum[]): number[] {
  const max = Math.max(0, ...data.map((d) => Math.abs(d.value ?? 0)));
  return data.map((d) => (max === 0 ? 0 : (Math.abs(d.value ?? 0) / max) * 100));
}

export interface LinePoint {
  x: number;
  y: number;
  datum: ChartDatum;
}

/**
 * Points for a line chart in a `width` by `height` box: one per group,
 * centred in equal columns (so labels under the chart line up), scaled from
 * the smaller of 0 and the lowest value to the highest. Empty totals are
 * left out of the line rather than drawn as zero.
 */
export function linePoints(data: ChartDatum[], width: number, height: number, pad = 12): LinePoint[] {
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const column = width / Math.max(1, data.length);
  return data.flatMap((datum, i) =>
    datum.value === null
      ? []
      : [{ x: column * (i + 0.5), y: pad + (1 - (datum.value - lo) / span) * (height - pad * 2), datum }],
  );
}

export interface PieSlice {
  key: string;
  label: string;
  value: number;
  /** Share of the whole, 0–100. */
  percent: number;
  /** Where the slice starts, 0–100 around the circle. */
  offset: number;
  /** The categorical palette slot, 1–8, in a fixed order (never cycled). */
  slot: number;
}

/**
 * Slices for a pie: positive totals only (a share of a whole cannot be
 * negative), largest first, at most PIE_SLICES of them; past that the
 * smallest fold into one "Other" slice so no hue is ever reused.
 */
export function pieSlices(data: ChartDatum[], otherLabel: string, max = PIE_SLICES): PieSlice[] {
  const positive = data.filter((d) => d.value !== null && d.value > 0).sort((a, b) => b.value! - a.value!);
  const kept = positive.length > max ? positive.slice(0, max - 1) : positive;
  const rest = positive.slice(kept.length);
  const items = rest.length
    ? [...kept.map((d) => ({ key: d.key, label: d.label, value: d.value! })), { key: "__other", label: otherLabel, value: rest.reduce((s, d) => s + d.value!, 0) }]
    : kept.map((d) => ({ key: d.key, label: d.label, value: d.value! }));
  const whole = items.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  return items.map((item, i) => {
    const percent = whole === 0 ? 0 : (item.value / whole) * 100;
    const slice = { ...item, percent, offset, slot: i + 1 };
    offset += percent;
    return slice;
  });
}

/** Each group's share of the positive whole (what a pie draws), 0–100; zero for empty or non-positive totals. */
export function chartShares(data: ChartDatum[]): number[] {
  const whole = data.reduce((sum, d) => sum + (d.value !== null && d.value > 0 ? d.value : 0), 0);
  return data.map((d) => (whole > 0 && d.value !== null && d.value > 0 ? (d.value / whole) * 100 : 0));
}

/** The figure's overall number: the total over every row the viewer can open. */
export function chartTotal(result: Pick<AggregateResult, "totals">): number | null {
  return chartNumber(result.totals.m0);
}

/** The settings pickers' single "Total" choice: "count", or "sum:<property>" / "avg:<property>". */
export function chartTotalOption(settings: ChartSettings): string {
  return settings.total === "count" ? "count" : `${settings.total}:${settings.property}`;
}

/** Settings from a chart kind and a "Total" choice (anything unknown is a count). */
export function settingsFromTotalOption(kind: ChartKind, option: string): ChartSettings {
  const [fn, property] = option.split(":");
  if (fn === "avg" && kind === "pie") return { kind, total: "count" };
  return (fn === "sum" || fn === "avg") && property ? { kind, total: fn, property } : { kind, total: "count" };
}

/** The totals a chart kind may use: a pie shows counts and sums only. */
export const totalsFor = (kind: ChartKind): readonly ChartTotal[] => (kind === "pie" ? ["count", "sum"] : CHART_TOTALS);
