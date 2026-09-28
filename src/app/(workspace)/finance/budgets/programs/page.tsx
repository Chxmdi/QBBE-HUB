import type { Metadata } from "next";
import { FolderKanban, PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { requireStaff } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { fiscalYearLabel, monthLabel } from "@/features/budgets/budget";
import { BudgetReportTable } from "@/features/budgets/components/budget-report-table";
import { BudgetTabs } from "@/features/budgets/components/budget-tabs";
import { managedPrograms, programSummary } from "@/features/budgets/services/budget.queries";
import { todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.budgets.programs.metaTitle") };
}
export const dynamic = "force-dynamic";

/**
 * Program leads and managers follow their program's spending against the
 * approved budget: totals per account, never the journal entries behind them.
 */
export default async function ProgramBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const supabase = await createSupabasePageClient();
  const query = await searchParams;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const header = (
    <PageHeader
      eyebrow={t("finance.budgets.title")}
      title={t("finance.budgets.tabs.myPrograms")}
      description={t("finance.budgets.programs.description")}
    />
  );
  const programs = await managedPrograms(supabase, session.organizationId);
  if (programs.length === 0) {
    return (
      <div>
        {header}
        <BudgetTabs />
        <EmptyState
          icon={<FolderKanban />}
          title={t("finance.budgets.programs.noProgramTitle")}
          description={t("finance.budgets.programs.noProgramDescription")}
        />
      </div>
    );
  }

  const chosen = uuidParam(query.program);
  const program = programs.find((p) => p.id === chosen) ?? programs[0];
  const month = query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : todayIn(session.timeZone).slice(0, 7);
  const summary = await programSummary(supabase, program.id, month);

  return (
    <div>
      {header}
      <BudgetTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={t("finance.budgets.programs.formAria")}>
        <div className="min-w-52">
          <Label htmlFor="p-program">{t("finance.common.program")}</Label>
          <Select id="p-program" name="program" defaultValue={program.id}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="p-month">{t("finance.budgets.month")}</Label>
          <Input id="p-month" name="month" type="month" defaultValue={month} />
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.budgets.show")}
        </Button>
      </form>
      {summary.budget ? (
        <p className="meta mb-3">
          {t("finance.budgets.programs.summary", {
            program: program.name,
            budget: summary.budget.name,
            fiscalYear: fiscalYearLabel(summary.budget.fiscal_year_start, locale),
            version: summary.budget.version,
            month: monthLabel(month, locale),
          })}
        </p>
      ) : null}
      {summary.rows.length === 0 ? (
        <EmptyState
          icon={<PiggyBank />}
          title={t("finance.budgets.programs.emptyTitle")}
          description={t("finance.budgets.programs.emptyDescription")}
        />
      ) : (
        <BudgetReportTable rows={summary.rows} monthLabel={monthLabel(month, locale)} />
      )}
    </div>
  );
}
