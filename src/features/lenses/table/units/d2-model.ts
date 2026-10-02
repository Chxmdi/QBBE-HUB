/**
 * Wave 2 unit D2 (table columns) as pure functions: which totals a column
 * offers, the measures sent to `lens_aggregate`, the organization's column
 * settings applied to the catalog, and the per-group rows. The components in
 * d2-totals.tsx only wire these to the DOM.
 */

import { z } from "zod";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { AGGREGATE_LIMITS, measureId, type AggregateFn, type AggregateMeasure, type AggregateResult, type AggregateValue } from "@/lib/query/aggregate";
import type { LensSpec } from "@/lib/query/spec";
import { rawText, specFor, type ColumnState, type TableState } from "../model";

/** A column's total: one of the engine's functions, or none. */
export type TotalChoice = AggregateFn | "none";
export const TOTAL_CHOICES = ["none", "count", "count_empty", "count_filled", "sum", "avg", "min", "max"] as const satisfies readonly TotalChoice[];

export type TotalsChoices = Record<string, TotalChoice>;

const KEY = /^[a-z][a-z0-9_]{0,62}$/;

export const totalsChoicesSchema = z
  .record(z.string().regex(KEY), z.enum(TOTAL_CHOICES))
  .refine((value) => Object.keys(value).length <= 60, { message: "Too many columns." });

/** One organization column setting as the database keeps it. */
export interface ColumnSetting {
  property_key: string;
  name_en: string | null;
  name_fr: string | null;
  hidden: boolean;
}

/**
 * What the table page adds to the catalog type for D2: the viewer's saved
 * totals, whether they may manage columns, and the columns the organization
 * hid (still in the catalog as filter-only, so saved filters keep working).
 */
export interface D2TypeInfo {
  canManage: boolean;
  totals: TotalsChoices | null;
  hidden: string[];
  /** The catalog's own names, so a rename can show what it replaces. */
  original: Record<string, { en: string; fr: string }>;
}

export type D2CatalogType = CatalogType & { d2?: D2TypeInfo };

export function d2Info(type: CatalogType): D2TypeInfo | null {
  return (type as D2CatalogType).d2 ?? null;
}

/** The totals a column offers, by kind. Every column can count. */
export function allowedTotals(property: CatalogProperty): TotalChoice[] {
  const base: TotalChoice[] = ["none", "count", "count_empty", "count_filled"];
  if (property.kind === "number") return [...base, "sum", "avg", "min", "max"];
  if (property.kind === "date") return [...base, "min", "max"];
  return base;
}

/** The total a column shows before the viewer picks one. */
export function defaultTotal(property: CatalogProperty): TotalChoice {
  if (property.key === "title") return "count";
  if (property.kind === "number") return "sum";
  return "none";
}

/** The viewer's choice when it is still valid for the column, otherwise the default. */
export function totalFor(property: CatalogProperty, choices: TotalsChoices | null | undefined): TotalChoice {
  const chosen = choices?.[property.key];
  return chosen && allowedTotals(property).includes(chosen) ? chosen : defaultTotal(property);
}

export interface ColumnMeasure {
  column: string;
  fn: AggregateFn;
  /** The engine's id for this measure ("m0", ...). */
  id: string;
}

/**
 * The measures for the shown columns, in column order, at most the engine's
 * limit. Columns beyond the limit, or set to none, get no measure.
 */
export function measuresFor(
  shown: ColumnState[],
  properties: Map<string, CatalogProperty>,
  choices: TotalsChoices | null | undefined,
): { columns: ColumnMeasure[]; measures: AggregateMeasure[] } {
  const columns: ColumnMeasure[] = [];
  const measures: AggregateMeasure[] = [];
  for (const c of shown) {
    const p = properties.get(c.key);
    if (!p || p.filterOnly) continue;
    const fn = totalFor(p, choices);
    if (fn === "none") continue;
    if (measures.length >= AGGREGATE_LIMITS.maxMeasures) break;
    columns.push({ column: c.key, fn, id: measureId(measures.length) });
    measures.push(fn === "count" ? { fn } : { fn, property: c.key });
  }
  return { columns, measures };
}

/**
 * The spec totals run over: exactly the rows the table lists (filters, search
 * and grouping), with every page, not only the loaded one.
 */
export function aggregateSpecFor(typeKey: string, state: TableState): LensSpec {
  const spec = specFor(typeKey, state, 0);
  return {
    version: spec.version,
    type: spec.type,
    ...(spec.where ? { where: spec.where } : {}),
    ...(spec.groupBy ? { groupBy: spec.groupBy } : {}),
  };
}

export interface GroupTotalsRow {
  key: string | null;
  label: string;
  values: Record<string, AggregateValue>;
}

/** Each group's totals by column, labelled the way the table labels its groups. */
export function groupTotalsRows(
  result: AggregateResult,
  columns: ColumnMeasure[],
  groupProperty: CatalogProperty | undefined,
  locale: string,
  notSet: string,
): GroupTotalsRow[] {
  return (result.groups ?? []).map((g) => {
    let label: string;
    if (g.key === null) label = notSet;
    else if (g.label) label = g.label.label ?? notSet;
    else label = (groupProperty && rawText(groupProperty, g.key, locale)) ?? g.key;
    const values: Record<string, AggregateValue> = {};
    for (const c of columns) values[c.column] = g.totals[c.id] ?? null;
    return { key: g.key, label, values };
  });
}

/** Overall totals by column. */
export function overallTotals(result: AggregateResult, columns: ColumnMeasure[]): Record<string, AggregateValue> {
  const values: Record<string, AggregateValue> = {};
  for (const c of columns) values[c.column] = result.totals[c.id] ?? null;
  return values;
}

/**
 * The catalog type with the organization's column settings applied: renamed
 * columns carry the new names, hidden columns become filter-only (no longer
 * a column, still a filter, so a saved lens keeps its conditions).
 */
export function applyColumnSettings(type: CatalogType, settings: ColumnSetting[]): { type: CatalogType; hidden: string[] } {
  const byKey = new Map(settings.map((s) => [s.property_key, s]));
  const hidden: string[] = [];
  const properties = type.properties.map((p) => {
    const s = byKey.get(p.key);
    if (!s || p.filterOnly) return p;
    const next: CatalogProperty = {
      ...p,
      name: { en: s.name_en ?? p.name.en, fr: s.name_fr ?? p.name.fr },
    };
    if (s.hidden && p.key !== "title") {
      hidden.push(p.key);
      next.filterOnly = true;
    }
    return next;
  });
  return { type: { ...type, properties }, hidden };
}

export const columnRenameSchema = z
  .object({
    type: z.string().regex(KEY),
    property: z.string().regex(KEY),
    nameEn: z.string().trim().min(1).max(80),
    nameFr: z.string().trim().min(1).max(80),
  })
  .strict();

export const columnVisibilitySchema = z
  .object({
    type: z.string().regex(KEY),
    property: z.string().regex(KEY),
    hidden: z.boolean(),
  })
  .strict();

export const totalsSaveSchema = z
  .object({
    type: z.string().regex(KEY),
    choices: totalsChoicesSchema,
  })
  .strict();
