import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findProperty, type CatalogProperty } from "@/lib/query/catalog";
import { loadCatalog, runLensAll, type LensResult } from "@/lib/query/run";
import type { LensSpec } from "@/lib/query/spec";

/** Loads a lens and one catalog property on the server, as the viewer. */
export async function loadTaskLens(
  specs: LensSpec[],
  timeZone: string,
  property = "status",
): Promise<{ results: (LensResult | null)[]; property: CatalogProperty | null }> {
  const supabase = await createSupabaseServerClient();
  const [catalog, ...results] = await Promise.all([
    loadCatalog(supabase).catch(() => null),
    ...specs.map((spec) => runLensAll(supabase, spec, { timeZone }).catch(() => null)),
  ]);
  return {
    results: results as (LensResult | null)[],
    property: catalog ? findProperty(catalog, "task", property) ?? null : null,
  };
}
