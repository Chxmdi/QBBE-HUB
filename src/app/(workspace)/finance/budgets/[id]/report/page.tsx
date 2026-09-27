import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label, Select } from "@/components/ui/input";
import { fiscalMonths, fiscalYearLabel, monthLabel, reportMonth } from "@/features/budgets/budget";
import { BudgetReportTable } from "@/features/budgets/components/budget-report-table";
import { BudgetTabs } from "@/features/budgets/components/budget-tabs";
import { NoBudgetAccess } from "@/features/budgets/components/no-budget-access";
import { budgetOptions, budgetVsActual, getBudget } from "@/features/budgets/services/budget.queries";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.budgets.budgetVsActual") };
}
export const dynamic = "force-dynamic";

export default async function BudgetReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { session, supabase, canRead } = await getLedgerAccess();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.budgets.title")} title={t("finance.budgets.budgetVsActual")} />
        <BudgetTabs />
        <NoBudgetAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const budgetId = uuidParam(id);
  if (!budgetId) notFound();
  const [found, options] = await Promise.all([
    getBudget(supabase, session.organizationId, budgetId),
    budgetOptions(supabase, session.organizationId),
  ]);
  if (!found) notFound();
  const { budget } = found;

  const months = fiscalMonths(budget.fiscal_year_start);
  const month = reportMonth(budget.fiscal_year_start, todayIn(session.timeZone), query.month);
  const filters = {
    programId: uuidParam(query.program),
    projectId: uuidParam(query.project),
    fundId: uuidParam(query.fund),
  };
  const { rows, error } = await budgetVsActual(supabase, budget.id, month, filters);
  if (error) throw new Error(`Could not load the report: ${error.message}`);
  const exportQuery = new URLSearchParams({
    month,
    ...(filters.programId ? { program: filters.programId } : {}),
    ...(filters.projectId ? { project: filters.projectId } : {}),
    ...(filters.fundId ? { fund: filters.fundId } : {}),
  }).toString();

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.budgets.eyebrowWithYear", { fiscalYear: fiscalYearLabel(budget.fiscal_year_start, locale) })}
        title={t("finance.budgets.budgetVsActual")}
        description={t("finance.budgets.report.description", { name: budget.name, version: budget.version })}
      />
      <BudgetTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={t("finance.budgets.report.filtersAria")}>
        <div>
          <Label htmlFor="r-month">{t("finance.budgets.month")}</Label>
          <Select id="r-month" name="month" defaultValue={month}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, locale)}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-44">
          <Label htmlFor="r-program">{t("finance.common.program")}</Label>
          <Select id="r-program" name="program" defaultValue={filters.programId ?? ""}>
            <option value="">{t("finance.budgets.report.allPrograms")}</option>
            {options.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-44">
          <Label htmlFor="r-project">{t("finance.budgets.project")}</Label>
          <Select id="r-project" name="project" defaultValue={filters.projectId ?? ""}>
            <option value="">{t("finance.budgets.report.allProjects")}</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-44">
          <Label htmlFor="r-fund">{t("finance.common.fund")}</Label>
          <Select id="r-fund" name="fund" defaultValue={filters.fundId ?? ""}>
            <option value="">{t("finance.budgets.report.allFunds")}</option>
            {options.funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.budgets.show")}
        </Button>
        <Link
          href={`/api/finance/budgets/${budget.id}/report?${exportQuery}`}
          prefetch={false}
          className="inline-flex h-9.5 items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
        >
          <Download className="size-4" aria-hidden />
          {t("finance.common.exportCsv")}
        </Link>
      </form>
      <p className="meta mb-3">
        {t("finance.budgets.report.period", {
          month: monthLabel(month, locale),
          start: monthLabel(months[0], locale),
        })}
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<PiggyBank />}
          title={t("finance.budgets.report.emptyTitle")}
          description={t("finance.budgets.report.emptyDescription")}
        />
      ) : (
        <BudgetReportTable rows={rows} monthLabel={monthLabel(month, locale)} />
      )}
    </div>
  );
}
