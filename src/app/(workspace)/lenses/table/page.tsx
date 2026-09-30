import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { reportError } from "@/lib/observability";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog, runLens, type LensResult } from "@/lib/query/run";
import type { LensCatalog } from "@/lib/query/catalog";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { TableLens } from "@/features/lenses/table/table-lens";
import { defaultColumns, specFor, type TableState } from "@/features/lenses/table/model";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("table.title") };
}
export const dynamic = "force-dynamic";

/**
 * The table lens (M8b), hidden behind the wos_lenses switch and not in the
 * menu until integration. `?type=task` (default) or `?type=project`.
 */
export default async function TableLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  let catalog: LensCatalog = {};
  try {
    catalog = await loadCatalog(supabase);
  } catch (error) {
    // Shown as "could not be loaded" below, never as an empty table.
    reportError(error, { lens: "table", step: "catalog" });
    catalog = {};
  }
  const requested = typeof params.type === "string" ? params.type : "task";
  const typeKey = catalog[requested] ? requested : "task";
  const type = catalog[typeKey];

  const initialState: TableState | null = type
    ? { columns: defaultColumns(type), sort: { property: "title", direction: "asc" }, groupBy: null, search: "" }
    : null;

  let initial: LensResult | null = null;
  if (initialState) {
    try {
      initial = await runLens(supabase, specFor(typeKey, initialState), { timeZone: session.timeZone });
    } catch (error) {
      reportError(error, { lens: "table", step: "rows" });
      initial = null;
    }
  }
  const people = typeKey === "task" ? (await getPickerOptions()).people : [];

  return (
    <div>
      <PageHeader
        eyebrow={t(`types.${typeKey}` as "types.task")}
        title={t("table.title")}
        description={t("table.description")}
      />
      {type && initialState ? (
        <TableLens
          key={typeKey}
          type={type}
          initial={initial}
          initialState={initialState}
          people={people}
          timeZone={session.timeZone}
        />
      ) : (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      )}
    </div>
  );
}
