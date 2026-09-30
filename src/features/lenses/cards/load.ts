import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog, runLens, type LensResult } from "@/lib/query/run";
import type { CatalogProperty, LensCatalog } from "@/lib/query/catalog";
import type { LensSpec } from "@/lib/query/spec";
import { getLens } from "@/features/lenses/services/lens-store.queries";
import type { SavedLens } from "@/features/lenses/services/lens-store.types";
import { factsFor, viewSpec } from "./cards";

export interface ViewLens {
  lens: SavedLens | null;
  type: string;
  catalog: LensCatalog;
  facts: CatalogProperty[];
  result: LensResult;
}

/**
 * A lens loaded for the gallery or the feed: a saved lens (`lensId`) or a
 * type, its facts, and one page of rows in the view's order, as the viewer.
 */
export async function loadViewLens(input: {
  viewerId: string;
  timeZone: string;
  lensId?: string;
  type?: string;
  order: "lens" | "recent";
  limit: number;
  offset?: number;
  defaultWhere?: LensSpec["where"];
}): Promise<ViewLens> {
  const supabase = await createSupabaseServerClient();
  const [catalog, lens] = await Promise.all([
    loadCatalog(supabase),
    input.lensId ? getLens(input.viewerId, input.lensId) : Promise.resolve(null),
  ]);
  const type = lens?.typeKey && catalog[lens.typeKey] ? lens.typeKey : input.type && catalog[input.type] ? input.type : "task";
  const base: Partial<LensSpec> & { type: string } =
    lens && lens.typeKey === type ? { ...(lens.spec as LensSpec), type } : { type, ...(type === "task" && input.defaultWhere ? { where: input.defaultWhere } : {}) };
  const factKeys = factsFor(catalog, type, base.select);
  const result = await runLens(supabase, viewSpec(base, factKeys, input.order, input.limit, input.offset ?? 0), { timeZone: input.timeZone });
  const props = catalog[type].properties;
  return { lens, type, catalog, facts: factKeys.map((k) => props.find((p) => p.key === k)!).filter(Boolean), result };
}
