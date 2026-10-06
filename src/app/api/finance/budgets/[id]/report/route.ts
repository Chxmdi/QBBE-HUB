import { budgetReportCsv, fiscalMonths, fiscalYearLabel, reportMonth } from "@/features/budgets/budget";
import { budgetVsActual } from "@/features/budgets/services/budget.queries";
import { todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse, fundLabel } from "@/features/ledger/services/ledger.export";
import { getLocale, getT } from "@/lib/i18n/server";

/** Budget against actual as CSV (#153). The database decides who may run it. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const access = await authorizeLedgerExport();
  if (!access) return new Response(t("finance.budgets.errors.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const budgetId = uuidParam((await params).id);
  const { data: budget } = budgetId
    ? await supabase
        .from("budget")
        .select("id, name, version, fiscal_year_start")
        .eq("organization_id", session.organizationId)
        .eq("id", budgetId)
        .maybeSingle()
    : { data: null };
  if (!budget) return new Response(t("finance.budgets.errors.notFound"), { status: 404 });

  const url = new URL(request.url);
  const month = reportMonth(budget.fiscal_year_start, todayIn(session.timeZone), url.searchParams.get("month"));
  const filters = {
    programId: uuidParam(url.searchParams.get("program") ?? undefined),
    projectId: uuidParam(url.searchParams.get("project") ?? undefined),
    fundId: uuidParam(url.searchParams.get("fund") ?? undefined),
  };
  const { rows, error } = await budgetVsActual(supabase, budget.id, month, filters);
  if (error) return new Response(t("finance.budgets.errors.exportFailed"), { status: 500 });

  const [program, project] = await Promise.all([
    filters.programId
      ? supabase.from("program").select("name").eq("id", filters.programId).maybeSingle()
      : Promise.resolve({ data: null }),
    filters.projectId
      ? supabase.from("project").select("name").eq("id", filters.projectId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const described = [
    program.data ? t("finance.budgets.csv.program", { name: program.data.name }) : t("finance.budgets.csv.allPrograms"),
    project.data ? t("finance.budgets.csv.project", { name: project.data.name }) : t("finance.budgets.csv.allProjects"),
    `${await fundLabel(supabase, filters.fundId)}.`,
  ].join(" ");
  const label = t("finance.budgets.csv.budgetLabel", {
    name: budget.name,
    fiscalYear: fiscalYearLabel(budget.fiscal_year_start, locale),
    version: budget.version,
  });

  return csvResponse(
    supabase,
    session,
    "budget_report_exported",
    budgetReportCsv(rows, { budget: label, month, filters: described }, t),
    `budget-vs-actual-${fiscalMonths(budget.fiscal_year_start)[0]}-v${budget.version}-${month}.csv`,
    { budget_id: budget.id, month, ...filters, rows: rows.length },
  );
}
