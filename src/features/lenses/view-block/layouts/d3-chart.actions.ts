"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runLensAggregate, type AggregateResult } from "@/lib/query/aggregate";
import { QueryError } from "@/lib/query/errors";
import { loadCatalog } from "@/lib/query/run";
import { lensSpecSchema, type LensSpec } from "@/lib/query/spec";
import type { LensCatalog } from "@/lib/query/catalog";
import { getLens } from "@/features/lenses/services/lens-store.queries";
import { mergeLocalFilters } from "../local-filters";
import { composeSpec, DEFAULT_GROUP, parseViewBlockProps, viewConditionSchema } from "../schema";
import { chartMeasures, chartSpec, readChartSettings } from "./d3-chart";

/**
 * Data for a view block's chart layout (wave 2 unit D3). The block's spec,
 * composed exactly as the block's rows are (saved lens, block conditions,
 * the reader's page-local filters on the paths the block allows), totalled
 * by `lens_aggregate` as the signed-in reader: row-level security decides
 * every row counted. Off while the wos_lenses switch is off. Read only.
 */

export type ChartRunFailure = "off" | "invalid" | "missing" | "failed" | "needsGroup";

export type ChartRun = { ok: true; result: AggregateResult } | { ok: false; reason: ChartRunFailure };

const localSchema = z.array(viewConditionSchema).max(20);

export async function runChartBlock(propsInput: unknown, localInput: unknown): Promise<ChartRun> {
  if (!(await isEnabled("wos_lenses"))) return { ok: false, reason: "off" };
  const session = await requireSession();
  const props = parseViewBlockProps(propsInput);
  const local = localSchema.safeParse(localInput ?? []);
  if (!props || props.layout !== "chart" || !local.success) return { ok: false, reason: "invalid" };
  const supabase = await createSupabaseServerClient();

  let base: LensSpec | null = null;
  let catalog: LensCatalog;
  try {
    const [loadedCatalog, saved] = await Promise.all([
      loadCatalog(supabase),
      "lensId" in props.source ? getLens(session.userId, props.source.lensId) : Promise.resolve(null),
    ]);
    catalog = loadedCatalog;
    if ("lensId" in props.source) {
      if (!saved) return { ok: false, reason: "missing" };
      const parsedBase = lensSpecSchema.safeParse(saved.spec);
      if (!parsedBase.success) return { ok: false, reason: "invalid" };
      base = parsedBase.data;
    }
  } catch {
    return { ok: false, reason: "failed" };
  }
  const type = base ? base.type : "type" in props.source ? props.source.type : "task";
  const catalogType = catalog[type];
  if (!catalogType) return { ok: false, reason: "invalid" };

  const extra = mergeLocalFilters([], local.data, props.pageFilters.enabled ? props.pageFilters.paths : []);
  const settings = readChartSettings(props.chart);
  const spec = chartSpec(composeSpec({ type, base, props, extra }), settings, catalogType, DEFAULT_GROUP[type]);
  if (spec === "needsGroup" || spec === "invalid") return { ok: false, reason: spec };
  try {
    const result = await runLensAggregate(supabase, spec, chartMeasures(settings), { timeZone: session.timeZone });
    return { ok: true, result };
  } catch (error) {
    if (error instanceof QueryError && error.code !== "failed" && error.code !== "signed_out") return { ok: false, reason: "invalid" };
    return { ok: false, reason: "failed" };
  }
}
