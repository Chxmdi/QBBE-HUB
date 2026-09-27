import type { Metadata } from "next";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fiscalYearLabel } from "@/features/budgets/budget";
import { CreateBudgetForm } from "@/features/budgets/components/budget-forms";
import { BudgetTabs } from "@/features/budgets/components/budget-tabs";
import { NoBudgetAccess } from "@/features/budgets/components/no-budget-access";
import { BUDGET_STATUS_LABEL, listBudgets } from "@/features/budgets/services/budget.queries";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Budgets" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "warning", approved: "success", superseded: "neutral" } as const;

export default async function BudgetsPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Finance"
      title="Budgets"
      description="Annual budgets by account, optionally by fund, program and project, compared with what was actually posted to the ledger."
    />
  );
  if (!canRead) {
    return (
      <div>
        {header}
        <BudgetTabs />
        <NoBudgetAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const [budgets, { data: firstOpen }] = await Promise.all([
    listBudgets(supabase, session.organizationId),
    supabase
      .from("ledger_period")
      .select("starts_on")
      .eq("organization_id", session.organizationId)
      .eq("status", "open")
      .order("starts_on")
      .limit(1)
      .maybeSingle(),
  ]);
  const defaultMonth = (firstOpen?.starts_on as string | undefined)?.slice(0, 7) ?? todayIn(session.timeZone).slice(0, 7);

  return (
    <div>
      {header}
      <BudgetTabs />
      {canManage ? (
        <section aria-labelledby="new-budget" className="mb-6">
          <h2 id="new-budget" className="mb-2 text-[15px] font-semibold">
            New budget
          </h2>
          <CreateBudgetForm defaultMonth={defaultMonth} />
        </section>
      ) : null}

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PiggyBank />}
          title="No budgets yet"
          description={
            canManage
              ? "Create the budget for a fiscal year, add its lines, then approve it."
              : "An administrator creates and approves budgets."
          }
        />
      ) : (
        <DataTable minWidth="640px">
          <TableHead>
            <TableHeader className="w-32">Fiscal year</TableHeader>
            <TableHeader>Budget</TableHeader>
            <TableHeader className="w-20">Version</TableHeader>
            <TableHeader className="w-32">Status</TableHeader>
            <TableHeader className="w-36">Approved</TableHeader>
            <TableHeader className="w-40">{""}</TableHeader>
          </TableHead>
          <tbody>
            {budgets.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{fiscalYearLabel(b.fiscal_year_start)}</TableCell>
                <TableCell>
                  <Link className="text-brand-fg hover:underline" href={`/finance/budgets/${b.id}`}>
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">v{b.version}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[b.status]}>{BUDGET_STATUS_LABEL[b.status]}</Badge>
                </TableCell>
                <TableCell className="text-[13px] text-muted">{b.approved_at?.slice(0, 10) ?? ""}</TableCell>
                <TableCell>
                  <Link className="text-[13px] text-brand-fg hover:underline" href={`/finance/budgets/${b.id}/report`}>
                    Budget vs actual
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
