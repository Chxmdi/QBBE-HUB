import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { reportError } from "@/lib/observability";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/query/run";
import type { LensCatalog } from "@/lib/query/catalog";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { ImportWizard } from "@/features/lenses/csv/import-wizard";
import { isImportType, IMPORT_TYPES } from "@/features/lenses/csv/mapping";
import { loadImportRefs } from "@/features/lenses/csv/refs";
import { IMPORT_ROW_LIMIT } from "@/features/objects/actions/import-rows";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("csv.title") };
}
export const dynamic = "force-dynamic";

/**
 * The CSV import wizard (Workspace OS U15), behind the wos_lenses switch and
 * reached from the lenses index. `?type=task` (default) or `?type=project`.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  await requireSession();
  const t = await getLensT();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  let catalog: LensCatalog = {};
  let refs = null;
  try {
    [catalog, refs] = await Promise.all([loadCatalog(supabase), loadImportRefs(supabase)]);
  } catch (error) {
    reportError(error, { lens: "import", step: "catalog" });
  }
  const types = IMPORT_TYPES.map((key) => catalog[key]).filter((type) => type !== undefined);
  const requested = typeof params.type === "string" ? params.type : "task";
  const initialType = isImportType(requested) && catalog[requested] ? requested : "task";

  return (
    <div>
      <PageHeader title={t("csv.title")} description={t("csv.description")} />
      {types.length > 0 && refs ? (
        <ImportWizard types={types} initialType={initialType} refs={refs} limit={IMPORT_ROW_LIMIT} />
      ) : (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      )}
    </div>
  );
}
