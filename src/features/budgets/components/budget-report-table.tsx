import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCents } from "@/features/ledger/money";
import {
  formatPercent,
  netTotals,
  sumRows,
  variance,
  type BudgetAccountType,
  type BudgetReportRow,
} from "@/features/budgets/budget";

type Totals = ReturnType<typeof sumRows>;

function VarianceCell({ type, budget, actual }: { type: BudgetAccountType; budget: number; actual: number }) {
  const v = variance(type, budget, actual);
  return (
    <>
      <TableCell className={cn("text-right tabular-nums", v.cents < 0 && "text-danger-fg")}>
        {formatCents(v.cents)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", v.cents < 0 && "text-danger-fg")}>
        {formatPercent(v.percent)}
      </TableCell>
    </>
  );
}

function Figures({ t, type }: { t: Totals; type: BudgetAccountType }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{formatCents(t.month_budget_cents)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCents(t.month_actual_cents)}</TableCell>
      <VarianceCell type={type} budget={t.month_budget_cents} actual={t.month_actual_cents} />
      <TableCell className="text-right tabular-nums">{formatCents(t.ytd_budget_cents)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCents(t.ytd_actual_cents)}</TableCell>
      <VarianceCell type={type} budget={t.ytd_budget_cents} actual={t.ytd_actual_cents} />
      <TableCell className="text-right tabular-nums">{formatCents(t.annual_budget_cents)}</TableCell>
    </>
  );
}

/**
 * Budget against actual per account for a month and the year to date, with
 * revenue and expense subtotals and the net. Variance is positive when
 * favourable and shown in red when not.
 */
export function BudgetReportTable({ rows, monthLabel }: { rows: BudgetReportRow[]; monthLabel: string }) {
  return (
    <DataTable minWidth="1080px">
      <TableHead>
        <TableHeader className="w-20">Account</TableHeader>
        <TableHeader>Name</TableHeader>
        <TableHeader className="text-right">{monthLabel} budget</TableHeader>
        <TableHeader className="text-right">{monthLabel} actual</TableHeader>
        <TableHeader className="text-right">Variance</TableHeader>
        <TableHeader className="text-right">%</TableHeader>
        <TableHeader className="text-right">YTD budget</TableHeader>
        <TableHeader className="text-right">YTD actual</TableHeader>
        <TableHeader className="text-right">YTD variance</TableHeader>
        <TableHeader className="text-right">%</TableHeader>
        <TableHeader className="text-right">Annual budget</TableHeader>
      </TableHead>
      <tbody>
        {(["revenue", "expense"] as const).map((type) => {
          const group = rows.filter((r) => r.account_type === type);
          if (group.length === 0) return null;
          return [
            ...group.map((r) => (
              <TableRow key={r.account_id}>
                <TableCell className="font-mono tabular-nums">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <Figures t={r} type={type} />
              </TableRow>
            )),
            <TableRow key={`total-${type}`} className="font-semibold">
              <TableCell>{""}</TableCell>
              <TableCell>{type === "revenue" ? "Total revenue" : "Total expense"}</TableCell>
              <Figures t={sumRows(group)} type={type} />
            </TableRow>,
          ];
        })}
        <TableRow className="border-t-2 border-line font-semibold">
          <TableCell>{""}</TableCell>
          <TableCell>Net (revenue less expense)</TableCell>
          <Figures t={netTotals(rows)} type="revenue" />
        </TableRow>
      </tbody>
    </DataTable>
  );
}
