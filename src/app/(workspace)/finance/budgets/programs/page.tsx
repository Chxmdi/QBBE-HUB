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

export const metadata: Metadata = { title: "My programs' budgets" };
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
  const header = (
    <PageHeader
      eyebrow="Budgets"
      title="My programs"
      description="Spending and revenue for the programs you lead or manage, against the approved budget. Totals per account from posted entries."
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
          title="You do not lead or manage a program"
          description="Program leads and managers see their program's budget here."
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
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label="Program and month">
        <div className="min-w-52">
          <Label htmlFor="p-program">Program</Label>
          <Select id="p-program" name="program" defaultValue={program.id}>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="p-month">Month</Label>
          <Input id="p-month" name="month" type="month" defaultValue={month} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      {summary.budget ? (
        <p className="meta mb-3">
          {program.name}: {summary.budget.name}, {fiscalYearLabel(summary.budget.fiscal_year_start)}, version{" "}
          {summary.budget.version}. {monthLabel(month)} and the year to date.
        </p>
      ) : null}
      {summary.rows.length === 0 ? (
        <EmptyState
          icon={<PiggyBank />}
          title="Nothing to show for this month"
          description="Either no approved budget covers this month, or nothing was budgeted or posted for this program yet."
        />
      ) : (
        <BudgetReportTable rows={summary.rows} monthLabel={monthLabel(month)} />
      )}
    </div>
  );
}
