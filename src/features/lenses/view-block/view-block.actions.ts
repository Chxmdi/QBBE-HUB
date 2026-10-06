"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { QueryError } from "@/lib/query/errors";
import { loadCatalog, runLens, type LensResult } from "@/lib/query/run";
import { lensSpecSchema, type LensSpec } from "@/lib/query/spec";
import type { LensCatalog } from "@/lib/query/catalog";
import { getLens, listLenses } from "@/features/lenses/services/lens-store.queries";
import { mergeLocalFilters } from "./local-filters";
import { calendarDateInZone } from "@/lib/time";
import { calendarRange, calendarSpec } from "@/features/lenses/calendar/model";
import { calendarPath, composeSpec, parseViewBlockProps, viewConditionSchema } from "./schema";
import { withD4Columns } from "./layouts/d4.ids";
import { isCalendarDate } from "@/lib/schema";

/**
 * Data for view blocks (U6). Each read runs as the signed-in reader through
 * `lens_query`, so row-level security decides every row; the block can only
 * ask, never widen. Off while the wos_lenses switch is off, like /lenses.
 */

export type ViewBlockFailure = "off" | "invalid" | "missing" | "failed";

export type ViewBlockRun =
  | {
      ok: true;
      type: string;
      lens: { id: string; name: string } | null;
      catalog: LensCatalog;
      result: LensResult;
      /** The date property a calendar layout used, when it did. */
      datePath: string | null;
      timeZone: string;
    }
  | { ok: false; reason: ViewBlockFailure };

export interface ViewBlockLensOption {
  id: string;
  name: string;
  typeKey: string | null;
  visibility: "personal" | "shared";
}

export type ViewBlockOptions =
  | { ok: true; catalog: LensCatalog; lenses: ViewBlockLensOption[] }
  | { ok: false; reason: ViewBlockFailure };

const localSchema = z.array(viewConditionSchema).max(20);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate);
const windowSchema = z.object({ from: isoDay, to: isoDay }).strict().optional();

async function ready() {
  if (!(await isEnabled("wos_lenses"))) return null;
  const session = await requireSession();
  return { session, supabase: await createSupabaseServerClient() };
}

/**
 * Runs a block for the reader. `localInput` carries the page-local filters
 * the reader set (merged in here, only on the properties the block allows);
 * `windowInput` is the calendar layout's visible range.
 */
export async function runViewBlock(propsInput: unknown, localInput: unknown, windowInput?: unknown): Promise<ViewBlockRun> {
  const context = await ready();
  if (!context) return { ok: false, reason: "off" };
  const props = parseViewBlockProps(propsInput);
  const local = localSchema.safeParse(localInput ?? []);
  const window = windowSchema.safeParse(windowInput ?? undefined);
  if (!props || !local.success || !window.success) return { ok: false, reason: "invalid" };
  const { session, supabase } = context;

  let base: LensSpec | null = null;
  let lens: { id: string; name: string } | null = null;
  let catalog: LensCatalog;
  try {
    // The saved lens and the catalog do not depend on each other.
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
      lens = { id: saved.id, name: saved.name };
    }
  } catch {
    return { ok: false, reason: "failed" };
  }
  const type = base ? base.type : "type" in props.source ? props.source.type : "task";
  const catalogType = catalog[type];
  if (!catalogType) return { ok: false, reason: "invalid" };

  try {
    // Only the reader's filters: composeSpec adds the block's own conditions.
    const extra = mergeLocalFilters([], local.data, props.pageFilters.enabled ? props.pageFilters.paths : []);
    let spec = withD4Columns(composeSpec({ type, base, props, extra }), props, type, catalogType.properties);
    let datePath: string | null = null;
    if (props.layout === "calendar") {
      const dateKeys = catalogType.properties.filter((p) => p.kind === "date" && !p.timestamp && !p.filterOnly).map((p) => p.key);
      datePath = calendarPath(props, type, dateKeys);
      if (!datePath) return { ok: false, reason: "invalid" };
      // The calendar lens's own narrowing (window, date sort, date field), capped like any block.
      const range = window.data ?? calendarRange("month", calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10));
      spec = { ...calendarSpec(spec, datePath, range), limit: spec.limit, offset: 0 };
    }
    const result = await runLens(supabase, spec, { timeZone: session.timeZone });
    return { ok: true, type, lens, catalog, result, datePath, timeZone: session.timeZone };
  } catch (error) {
    if (error instanceof QueryError && error.code !== "failed" && error.code !== "signed_out") {
      return { ok: false, reason: "invalid" };
    }
    return { ok: false, reason: "failed" };
  }
}

/** Whether view blocks can run here (the wos_lenses switch), so the editor offers "Turn into a view" only then. */
export async function viewBlocksEnabled(): Promise<boolean> {
  return isEnabled("wos_lenses");
}

/** The types and saved lenses the reader can choose from in the block's settings. */
export async function loadViewBlockOptions(): Promise<ViewBlockOptions> {
  const context = await ready();
  if (!context) return { ok: false, reason: "off" };
  try {
    const [catalog, lenses] = await Promise.all([loadCatalog(context.supabase), listLenses(context.session.userId)]);
    return {
      ok: true,
      catalog,
      lenses: lenses
        .filter((lens) => lens.typeKey && catalog[lens.typeKey] && lensSpecSchema.safeParse(lens.spec).success)
        .map((lens) => ({ id: lens.id, name: lens.name, typeKey: lens.typeKey, visibility: lens.visibility })),
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
