/**
 * Budgets against actuals (#153): phasing, months of a fiscal year and
 * variance. Amounts are integer cents in the account's natural direction
 * (revenue coming in, expense going out).
 */
import { centsToDecimal, csvField } from "@/features/ledger/money";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatNumber } from "@/lib/i18n/format";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

export const MONTHS_IN_YEAR = 12;

/**
 * An annual amount spread evenly over twelve months. Cents that do not divide
 * evenly go to the first months, one each, so the months always add up to
 * the annual amount exactly.
 */
export function evenSplit(annualCents: number): number[] {
  const base = Math.floor(annualCents / MONTHS_IN_YEAR);
  const remainder = annualCents - base * MONTHS_IN_YEAR;
  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** "2026-10-01" → ["2026-10", "2026-11", …, "2027-09"]. */
export function fiscalMonths(fiscalYearStart: string): string[] {
  const [year, month] = fiscalYearStart.split("-").map(Number);
  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
    const m = month - 1 + i;
    const y = year + Math.floor(m / 12);
    return `${y}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026" (French: "oct. 2026"). */
export function monthLabel(month: string, locale: Locale = "en"): string {
  const [y, m] = month.split("-").map(Number);
  if (locale === "en") return `${MONTH_NAMES[m - 1]} ${y}`;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, 1),
  );
}

/** "2026-10-01" → "FY 2026-27" (a calendar-year budget reads "FY 2027"). */
export function fiscalYearLabel(fiscalYearStart: string, locale: Locale = "en"): string {
  const [year, month] = fiscalYearStart.split("-").map(Number);
  const years = month === 1 ? String(year) : `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  return createTranslator(locale)("finance.budgets.fiscalYear", { years });
}

/**
 * The month the report opens on: this month while the fiscal year runs, its
 * first month before it starts, its last month once it is over. A month the
 * person chose wins when it is inside the year.
 */
export function reportMonth(fiscalYearStart: string, today: string, chosen?: string | null): string {
  const months = fiscalMonths(fiscalYearStart);
  if (chosen && months.includes(chosen)) return chosen;
  const current = today.slice(0, 7);
  if (current < months[0]) return months[0];
  if (current > months[MONTHS_IN_YEAR - 1]) return months[MONTHS_IN_YEAR - 1];
  return current;
}

export type BudgetAccountType = "revenue" | "expense";

/**
 * Variance where positive is favourable: revenue above budget, or spending
 * below it. The percentage is of the budget's size (so a budgeted deficit
 * reads the same way), to one decimal, and null when nothing was budgeted.
 */
export function variance(
  accountType: BudgetAccountType,
  budgetCents: number,
  actualCents: number,
): { cents: number; percent: number | null } {
  const cents = accountType === "revenue" ? actualCents - budgetCents : budgetCents - actualCents;
  const percent = budgetCents === 0 ? null : Math.round((cents / Math.abs(budgetCents)) * 1000) / 10;
  return { cents, percent };
}

export function formatPercent(percent: number | null, locale: Locale = "en"): string {
  if (percent === null) return "—";
  const sign = percent > 0 ? "+" : "";
  if (locale === "en") return `${sign}${percent.toFixed(1)}%`;
  // French: decimal comma and a non-breaking space before the percent sign.
  const digits = formatNumber(percent, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${sign}${digits}\u00a0%`;
}

export interface BudgetReportRow {
  account_id: string;
  code: string;
  name: string;
  account_type: BudgetAccountType;
  annual_budget_cents: number;
  month_budget_cents: number;
  ytd_budget_cents: number;
  month_actual_cents: number;
  ytd_actual_cents: number;
}

type Totals = Omit<BudgetReportRow, "account_id" | "code" | "name" | "account_type">;

const ZERO: Totals = {
  annual_budget_cents: 0,
  month_budget_cents: 0,
  ytd_budget_cents: 0,
  month_actual_cents: 0,
  ytd_actual_cents: 0,
};

/** Numbers from the database arrive as strings for bigint; make them numbers. */
export function normalizeRows(data: unknown): BudgetReportRow[] {
  return ((data ?? []) as BudgetReportRow[]).map((r) => ({
    ...r,
    annual_budget_cents: Number(r.annual_budget_cents),
    month_budget_cents: Number(r.month_budget_cents),
    ytd_budget_cents: Number(r.ytd_budget_cents),
    month_actual_cents: Number(r.month_actual_cents),
    ytd_actual_cents: Number(r.ytd_actual_cents),
  }));
}

export function sumRows(rows: BudgetReportRow[]): Totals {
  return rows.reduce<Totals>(
    (t, r) => ({
      annual_budget_cents: t.annual_budget_cents + r.annual_budget_cents,
      month_budget_cents: t.month_budget_cents + r.month_budget_cents,
      ytd_budget_cents: t.ytd_budget_cents + r.ytd_budget_cents,
      month_actual_cents: t.month_actual_cents + r.month_actual_cents,
      ytd_actual_cents: t.ytd_actual_cents + r.ytd_actual_cents,
    }),
    { ...ZERO },
  );
}

/** Revenue less expense for each column: the surplus (or deficit). */
export function netTotals(rows: BudgetReportRow[]): Totals {
  const revenue = sumRows(rows.filter((r) => r.account_type === "revenue"));
  const expense = sumRows(rows.filter((r) => r.account_type === "expense"));
  return {
    annual_budget_cents: revenue.annual_budget_cents - expense.annual_budget_cents,
    month_budget_cents: revenue.month_budget_cents - expense.month_budget_cents,
    ytd_budget_cents: revenue.ytd_budget_cents - expense.ytd_budget_cents,
    month_actual_cents: revenue.month_actual_cents - expense.month_actual_cents,
    ytd_actual_cents: revenue.ytd_actual_cents - expense.ytd_actual_cents,
  };
}

const TYPE_LABEL: Record<BudgetAccountType, MessageKey> = {
  revenue: "finance.common.accountTypes.revenue",
  expense: "finance.common.accountTypes.expense",
};

const TOTAL_LABEL: Record<BudgetAccountType, MessageKey> = {
  revenue: "finance.budgets.totalRevenue",
  expense: "finance.budgets.totalExpense",
};

/**
 * The report as a spreadsheet: one row per account, then totals. Headings
 * follow `t`'s language (English by default); figures stay plain decimals.
 */
export function budgetReportCsv(
  rows: BudgetReportRow[],
  heading: { budget: string; month: string; filters: string },
  t: TranslateFn = createTranslator("en"),
): string {
  const line = (label: [string, string, string], t: Totals, type: BudgetAccountType) => {
    const m = variance(type, t.month_budget_cents, t.month_actual_cents);
    const y = variance(type, t.ytd_budget_cents, t.ytd_actual_cents);
    return [
      ...label,
      centsToDecimal(t.month_budget_cents),
      centsToDecimal(t.month_actual_cents),
      centsToDecimal(m.cents),
      m.percent === null ? "" : m.percent.toFixed(1),
      centsToDecimal(t.ytd_budget_cents),
      centsToDecimal(t.ytd_actual_cents),
      centsToDecimal(y.cents),
      y.percent === null ? "" : y.percent.toFixed(1),
      centsToDecimal(t.annual_budget_cents),
    ];
  };
  const out: (string | number)[][] = [
    [t("finance.budgets.csv.title", { budget: heading.budget })],
    [t("finance.budgets.csv.period", { month: heading.month, filters: heading.filters })],
    [t("finance.budgets.csv.varianceNote")],
    [],
    [
      t("finance.budgets.csv.colAccount"),
      t("finance.budgets.csv.colName"),
      t("finance.budgets.csv.colType"),
      t("finance.budgets.csv.colMonthBudget"),
      t("finance.budgets.csv.colMonthActual"),
      t("finance.budgets.csv.colMonthVariance"),
      t("finance.budgets.csv.colMonthVariancePercent"),
      t("finance.budgets.csv.colYtdBudget"),
      t("finance.budgets.csv.colYtdActual"),
      t("finance.budgets.csv.colYtdVariance"),
      t("finance.budgets.csv.colYtdVariancePercent"),
      t("finance.budgets.csv.colAnnualBudget"),
    ],
  ];
  for (const r of rows) out.push(line([r.code, r.name, t(TYPE_LABEL[r.account_type])], r, r.account_type));
  for (const type of ["revenue", "expense"] as const) {
    const group = rows.filter((r) => r.account_type === type);
    if (group.length) out.push(line(["", t(TOTAL_LABEL[type]), t(TYPE_LABEL[type])], sumRows(group), type));
  }
  // Net behaves like revenue: more is better.
  out.push(line(["", t("finance.budgets.netRevenueLessExpense"), ""], netTotals(rows), "revenue"));
  return csvRows(out);
}

// A signed decimal amount is written as is: it is a number, not a formula,
// though csvField would otherwise guard its leading minus sign.
const AMOUNT = /^-?\d+(\.\d+)?$/;

/** A CSV document as Excel reads it: byte-order mark, CRLF line ends. */
function csvRows(rows: (string | number)[][]): string {
  const cell = (v: string | number) => (typeof v === "string" && AMOUNT.test(v) ? v : csvField(v));
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
