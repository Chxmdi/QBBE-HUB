import type { Locale } from "@/lib/i18n/config";
import { localized, type LensCatalog } from "@/lib/query/catalog";
import { loadCatalog, runLensAll } from "@/lib/query/run";
import { lensSpecSchema, LIMITS, type LensSpec } from "@/lib/query/spec";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EditorContent } from "@/features/editor/adapter/content";
import { lensToCsv } from "@/features/lenses/csv/export";
import { getLens } from "@/features/lenses/services/lens-store.queries";
import { composeSpec, parseViewBlockProps } from "@/features/lenses/view-block/schema";
import { findViewBlocks, type ExportedView } from "./transfer";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The CSV of each view block in a page (wave 2 unit X1). Every view runs
 * through `lens_query` as the exporter, exactly as the block does on screen,
 * so a file never holds a row the exporter could not open. The block's
 * filters, sort and columns apply; its "rows shown" cap and a reader's
 * page-local filters do not, because a file is the whole view, not a screen
 * of it (the same rule as a lens's own CSV). A view the exporter cannot run
 * (its saved lens is not theirs to see, its settings are damaged, or lenses
 * are switched off) is named in the Markdown and has no file.
 */
export async function exportViews(input: {
  supabase: ServerClient;
  userId: string;
  timeZone: string;
  locale: Locale;
  content: EditorContent;
  /** Whether view blocks run at all (the wos_lenses switch). */
  lensesOn: boolean;
  /** What an unnamed view is called, by its position. */
  fallbackName: (index: number) => string;
}): Promise<ExportedView[]> {
  const found = findViewBlocks(input.content);
  if (found.length === 0) return [];
  let catalog: LensCatalog | null = null;
  if (input.lensesOn) {
    try {
      catalog = await loadCatalog(input.supabase);
    } catch {
      catalog = null;
    }
  }

  const views: ExportedView[] = [];
  for (const [index, { block, raw }] of found.entries()) {
    const props = parseViewBlockProps(raw);
    const named = (extra?: string | null) => props?.title || extra || input.fallbackName(index + 1);
    if (!props || !catalog) {
      views.push({ block, name: named(), csv: null });
      continue;
    }
    try {
      let base: LensSpec | null = null;
      let lensName: string | null = null;
      if ("lensId" in props.source) {
        const saved = await getLens(input.userId, props.source.lensId);
        const parsed = saved ? lensSpecSchema.safeParse(saved.spec) : null;
        if (!saved || !parsed?.success) {
          views.push({ block, name: named(), csv: null });
          continue;
        }
        base = parsed.data;
        lensName = saved.name;
      }
      const type = base ? base.type : "type" in props.source ? props.source.type : "task";
      const catalogType = catalog[type];
      if (!catalogType) {
        views.push({ block, name: named(lensName), csv: null });
        continue;
      }
      const name = named(lensName ?? localized(catalogType.name, input.locale));
      const { limit: _limit, offset: _offset, ...whole } = composeSpec({ type, base, props, extra: [] });
      void _limit;
      void _offset;
      const result = await runLensAll(input.supabase, whole, { timeZone: input.timeZone, maxRows: LIMITS.maxOffset });
      views.push({ block, name, csv: lensToCsv(result, catalogType, input.locale, whole.select) });
    } catch {
      views.push({ block, name: named(), csv: null });
    }
  }
  return views;
}
