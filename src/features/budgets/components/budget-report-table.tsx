import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCents } from "@/features/ledger/money";
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";
import {
  formatPercent,
  netTotals,
  sumRows,
  variance,
  type BudgetAccountType,
  type BudgetReportRow,
} from "@/features/budgets/budget";

type Totals = ReturnType<typeof sumRows>;

function VarianceCell({
  type,
  budget,
  actual,
  locale,
}: {
  type: BudgetAccountType;
  budget: number;
  actual: number;
  locale: Locale;
}) {
  const v = variance(type, budget, actual);
  return (
    <>
      <TableCell className={cn("text-right tabular-nums", v.cents < 0 && "text-danger-fg")}>
        {formatCents(v.cents, locale)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", v.cents < 0 && "text-danger-fg")}>
        {formatPercent(v.percent, locale)}
      </TableCell>
    </>
  );
}

function Figures({ t, type, locale }: { t: Totals; type: BudgetAccountType; locale: Locale }) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{formatCents(t.month_budget_cents, locale)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCents(t.month_actual_cents, locale)}</TableCell>
      <VarianceCell type={type} budget={t.month_budget_cents} actual={t.month_actual_cents} locale={locale} />
      <TableCell className="text-right tabular-nums">{formatCents(t.ytd_budget_cents, locale)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCents(t.ytd_actual_cents, locale)}</TableCell>
      <VarianceCell type={type} budget={t.ytd_budget_cents} actual={t.ytd_actual_cents} locale={locale} />
      <TableCell className="text-right tabular-nums">{formatCents(t.annual_budget_cents, locale)}</TableCell>
    </>
  );
}

/**
 * Budget against actual per account for a month and the year to date, with
 * revenue and expense subtotals and the net. Variance is positive when
 * favourable and shown in red when not.
 */
export async function BudgetReportTable({ rows, monthLabel }: { rows: BudgetReportRow[]; monthLabel: string }) {
  const [tr, locale] = await Promise.all([getT(), getLocale()]);
  return (
    <DataTable minWidth="1080px">
      <TableHead>
        <TableHeader className="w-20">{tr("finance.common.account")}</TableHeader>
        <TableHeader>{tr("finance.budgets.name")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.monthBudget", { month: monthLabel })}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.monthActual", { month: monthLabel })}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.variance")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.percent")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.ytdBudget")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.ytdActual")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.ytdVariance")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.percent")}</TableHeader>
        <TableHeader className="text-right">{tr("finance.budgets.table.annualBudget")}</TableHeader>
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
                <Figures t={r} type={type} locale={locale} />
              </TableRow>
            )),
            <TableRow key={`total-${type}`} className="font-semibold">
              <TableCell>{""}</TableCell>
              <TableCell>{tr(type === "revenue" ? "finance.budgets.totalRevenue" : "finance.budgets.totalExpense")}</TableCell>
              <Figures t={sumRows(group)} type={type} locale={locale} />
            </TableRow>,
          ];
        })}
        <TableRow className="border-t-2 border-line font-semibold">
          <TableCell>{""}</TableCell>
          <TableCell>{tr("finance.budgets.netRevenueLessExpense")}</TableCell>
          <Figures t={netTotals(rows)} type="revenue" locale={locale} />
        </TableRow>
      </tbody>
    </DataTable>
  );
}
