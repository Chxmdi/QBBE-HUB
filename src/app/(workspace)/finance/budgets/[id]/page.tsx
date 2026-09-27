import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { evenSplit, fiscalMonths, fiscalYearLabel, monthLabel } from "@/features/budgets/budget";
import {
  BudgetActions,
  BudgetLineDialog,
  DeleteLineButton,
} from "@/features/budgets/components/budget-forms";
import { BudgetTabs } from "@/features/budgets/components/budget-tabs";
import { NoBudgetAccess } from "@/features/budgets/components/no-budget-access";
import { BUDGET_STATUS_LABEL, budgetOptions, getBudget } from "@/features/budgets/services/budget.queries";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess, uuidParam } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "warning", approved: "success", superseded: "neutral" } as const;

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Budgets" title="Budget" />
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
  const { budget, lines, versions } = found;
  const editable = canManage && budget.status === "draft";

  const account = new Map(options.accounts.map((a) => [a.id, a]));
  const fund = new Map(options.funds.map((f) => [f.id, f]));
  const program = new Map(options.programs.map((p) => [p.id, p]));
  const project = new Map(options.projects.map((p) => [p.id, p]));
  const sorted = [...lines].sort((a, b) =>
    (account.get(a.account_id)?.code ?? "").localeCompare(account.get(b.account_id)?.code ?? ""),
  );
  const months = fiscalMonths(budget.fiscal_year_start);
  const monthTotals = (type: "revenue" | "expense") =>
    months.map((_, i) =>
      lines
        .filter((l) => account.get(l.account_id)?.account_type === type)
        .reduce((s, l) => s + (l.month_cents[i] ?? 0), 0),
    );

  return (
    <div>
      <PageHeader
        eyebrow={`Budgets · ${fiscalYearLabel(budget.fiscal_year_start)}`}
        title={budget.name}
        description={budget.notes ?? undefined}
        actions={canManage ? <BudgetActions budgetId={budget.id} status={budget.status} /> : undefined}
      />
      <BudgetTabs />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13.5px]">
        <Badge tone={STATUS_TONE[budget.status]}>{BUDGET_STATUS_LABEL[budget.status]}</Badge>
        <span className="text-muted">
          Version {budget.version}
          {budget.approved_at ? ` · approved ${budget.approved_at.slice(0, 10)}` : ""}
          {budget.superseded_at ? ` · superseded ${budget.superseded_at.slice(0, 10)}` : ""}
        </span>
        <Link className="font-medium text-brand-fg hover:underline" href={`/finance/budgets/${budget.id}/report`}>
          Budget vs actual
        </Link>
        {budget.status !== "draft" ? (
          <span className="text-muted">Locked. Revise the budget to change it; this version stays on record.</span>
        ) : null}
      </div>

      <section aria-labelledby="lines" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="lines" className="text-[15px] font-semibold">
            Lines
          </h2>
          {editable ? (
            <BudgetLineDialog budgetId={budget.id} fiscalYearStart={budget.fiscal_year_start} options={options} />
          ) : null}
        </div>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<PiggyBank />}
            title="No lines yet"
            description={editable ? "Add a line for each revenue or expense account you plan for." : undefined}
          />
        ) : (
          <DataTable minWidth="820px">
            <TableHead>
              <TableHeader className="w-20">Account</TableHeader>
              <TableHeader>Name</TableHeader>
              <TableHeader className="w-28">Fund</TableHeader>
              <TableHeader>Program</TableHeader>
              <TableHeader>Project</TableHeader>
              <TableHeader className="w-36 text-right">Annual</TableHeader>
              <TableHeader className="w-24">Phasing</TableHeader>
              {editable ? <TableHeader className="w-24">{""}</TableHeader> : null}
            </TableHead>
            <tbody>
              {(["revenue", "expense"] as const).map((type) => {
                const group = sorted.filter((l) => account.get(l.account_id)?.account_type === type);
                if (group.length === 0) return null;
                return [
                  ...group.map((l) => {
                    const a = account.get(l.account_id);
                    const even = evenSplit(l.annual_cents).every((m, i) => m === l.month_cents[i]);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="font-mono tabular-nums">{a?.code}</TableCell>
                        <TableCell>
                          {a?.name}
                          {l.note ? <span className="block text-[12.5px] text-muted">{l.note}</span> : null}
                        </TableCell>
                        <TableCell className="text-[13px]">{l.fund_id ? fund.get(l.fund_id)?.code : "Any"}</TableCell>
                        <TableCell className="text-[13px]">{l.program_id ? program.get(l.program_id)?.name : ""}</TableCell>
                        <TableCell className="text-[13px]">{l.project_id ? project.get(l.project_id)?.name : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCents(l.annual_cents)}</TableCell>
                        <TableCell className="text-[13px] text-muted">{even ? "Even" : "Custom"}</TableCell>
                        {editable ? (
                          <TableCell>
                            <div className="flex justify-end">
                              <BudgetLineDialog
                                budgetId={budget.id}
                                fiscalYearStart={budget.fiscal_year_start}
                                options={options}
                                line={l}
                              />
                              <DeleteLineButton lineId={l.id} label={`${a?.code ?? ""} ${a?.name ?? ""}`.trim()} />
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  }),
                  <TableRow key={`total-${type}`} className="font-semibold">
                    <TableCell>{""}</TableCell>
                    <TableCell>{type === "revenue" ? "Total revenue" : "Total expense"}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(group.reduce((s, l) => s + l.annual_cents, 0))}
                    </TableCell>
                    <TableCell>{""}</TableCell>
                    {editable ? <TableCell>{""}</TableCell> : null}
                  </TableRow>,
                ];
              })}
            </tbody>
          </DataTable>
        )}
      </section>

      {sorted.length > 0 ? (
        <section aria-labelledby="by-month" className="mb-8">
          <h2 id="by-month" className="mb-2 text-[15px] font-semibold">
            By month
          </h2>
          <DataTable minWidth="420px">
            <TableHead>
              <TableHeader>Month</TableHeader>
              <TableHeader className="text-right">Revenue</TableHeader>
              <TableHeader className="text-right">Expense</TableHeader>
              <TableHeader className="text-right">Net</TableHeader>
            </TableHead>
            <tbody>
              {months.map((m, i) => {
                const revenue = monthTotals("revenue")[i];
                const expense = monthTotals("expense")[i];
                return (
                  <TableRow key={m}>
                    <TableCell>{monthLabel(m)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(expense)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(revenue - expense)}</TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </DataTable>
        </section>
      ) : null}

      <section aria-labelledby="versions">
        <h2 id="versions" className="mb-2 text-[15px] font-semibold">
          Versions
        </h2>
        <ul className="space-y-1 text-[13.5px]">
          {versions.map((v) => (
            <li key={v.id}>
              {v.id === budget.id ? (
                <span className="font-medium">Version {v.version} (this one)</span>
              ) : (
                <Link className="text-brand-fg hover:underline" href={`/finance/budgets/${v.id}`}>
                  Version {v.version}
                </Link>
              )}{" "}
              <span className="text-muted">
                · {BUDGET_STATUS_LABEL[v.status]}
                {v.approved_at ? ` · approved ${v.approved_at.slice(0, 10)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
