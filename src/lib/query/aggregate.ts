import { z } from "zod";
import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { QueryError, queryErrorFrom } from "./errors";
import { parseLensSpec, type RpcClient, type RunOptions } from "./run";

/**
 * Totals over a lens (wave 2 step 0): `public.lens_aggregate`, a caller's-rights
 * function, so a total only ever counts rows the viewer can read. Shared by the
 * table's totals row and chart layouts.
 */

export const AGGREGATE_FNS = ["count", "count_empty", "count_filled", "sum", "avg", "min", "max"] as const;
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

export const AGGREGATE_LIMITS = { maxMeasures: 20 } as const;

const measureSchema = z.union([
  z.object({ fn: z.literal("count") }).strict(),
  z.object({ fn: z.enum(AGGREGATE_FNS).exclude(["count"]), property: z.string().min(1).max(64) }).strict(),
]);
export type AggregateMeasure = z.infer<typeof measureSchema>;

const measuresSchema = z.array(measureSchema).min(1).max(AGGREGATE_LIMITS.maxMeasures);

/** A total's value: a number, a date as text, or null over no rows (or none filled). */
export type AggregateValue = number | string | null;

export interface AggregateGroup {
  key: string | null;
  label: { id: string; label: string | null } | null;
  /** By measure id ("m0", "m1", ... in the order asked). */
  totals: Record<string, AggregateValue>;
}

export interface AggregateResult {
  type: string;
  measures: { id: string; fn: AggregateFn; property: string | null }[];
  totals: Record<string, AggregateValue>;
  groupBy: string | null;
  groups: AggregateGroup[] | null;
}

/** Strict parse of the measures. Throws QueryError("invalid_spec"). */
export function parseMeasures(input: unknown): AggregateMeasure[] {
  const parsed = measuresSchema.safeParse(input);
  if (!parsed.success) throw new QueryError("invalid_spec", "The totals are not in the expected format.");
  return parsed.data;
}

/** The id the engine gives the measure at `index` (stable: "m" + position). */
export const measureId = (index: number) => `m${index}`;

export async function runLensAggregate(
  client: RpcClient,
  specInput: unknown,
  measuresInput: unknown,
  options: RunOptions = {},
): Promise<AggregateResult> {
  const spec = parseLensSpec(specInput);
  const measures = parseMeasures(measuresInput);
  const { data, error } = await client.rpc("lens_aggregate", {
    spec,
    measures,
    time_zone: options.timeZone ?? DEFAULT_TIME_ZONE,
  });
  if (error || !data) throw queryErrorFrom(error);
  const result = data as AggregateResult;
  return { ...result, totals: result.totals ?? {}, groups: result.groups ?? null };
}
