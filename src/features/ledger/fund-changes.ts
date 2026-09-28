/**
 * Statement of changes in fund balances (#149): per fund, the balance at the
 * start of the year, revenue, expenses, transfers and releases between funds,
 * and the balance at the end. Rows come from `ledger_fund_changes`, in integer
 * cents with a fund balance positive. Pure functions so they can be tested
 * without a database.
 */
import { centsToDecimal, csvDocument, FUND_RESTRICTION_KEY, type FundRestriction } from "@/features/ledger/money";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

export interface FundChangeRow {
  fund_id: string;
  code: string;
  name: string;
  restriction: FundRestriction;
  is_active: boolean;
  opening_cents: number;
  revenue_cents: number;
  expenses_cents: number;
  transfers_cents: number;
  closing_cents: number;
}

export type FundChangeAmounts = Pick<
  FundChangeRow,
  "opening_cents" | "revenue_cents" | "expenses_cents" | "transfers_cents" | "closing_cents"
>;

export interface FundChanges {
  from: string;
  to: string;
  funds: FundChangeRow[];
  totals: FundChangeAmounts;
  /** True when no fund has any amount in any column. */
  empty: boolean;
}

const AMOUNT_KEYS = ["opening_cents", "revenue_cents", "expenses_cents", "transfers_cents", "closing_cents"] as const;

function hasAmounts(row: FundChangeAmounts): boolean {
  return AMOUNT_KEYS.some((k) => row[k] !== 0);
}

/**
 * Funds with nothing in any column are left out unless still active, so a
 * retired, never-used fund does not clutter the statement. Totals include
 * every row the database returned.
 */
export function buildFundChanges(rows: FundChangeRow[], from: string, to: string): FundChanges {
  const totals: FundChangeAmounts = {
    opening_cents: 0,
    revenue_cents: 0,
    expenses_cents: 0,
    transfers_cents: 0,
    closing_cents: 0,
  };
  for (const r of rows) for (const k of AMOUNT_KEYS) totals[k] += r[k];
  const funds = rows
    .filter((r) => r.is_active || hasAmounts(r))
    .sort((a, b) => a.code.localeCompare(b.code));
  return { from, to, funds, totals, empty: !rows.some(hasAmounts) };
}

/** Whether a row adds up: start + revenue - expenses + transfers = end. */
export function rowAddsUp(row: FundChangeAmounts): boolean {
  return row.opening_cents + row.revenue_cents - row.expenses_cents + row.transfers_cents === row.closing_cents;
}

/** Converts the numeric strings PostgREST returns for bigint columns. */
export function normalizeFundChangeRow(r: FundChangeRow): FundChangeRow {
  return {
    ...r,
    opening_cents: Number(r.opening_cents),
    revenue_cents: Number(r.revenue_cents),
    expenses_cents: Number(r.expenses_cents),
    transfers_cents: Number(r.transfers_cents),
    closing_cents: Number(r.closing_cents),
  };
}

/** The CSV, headed in the reader's language; English by default. Figures stay plain decimals. */
export function fundChangesCsv(statement: FundChanges, t: TranslateFn = createTranslator("en")): string {
  const money = (cents: number) => centsToDecimal(cents);
  const rows: (string | number | null)[][] = [
    [
      t("finance.ledgerReports.csv.fundChangesTitle", { from: statement.from, to: statement.to }),
      t("finance.ledgerReports.csv.notFiled"),
    ],
    [
      t("finance.ledgerReports.statementTables.fund"),
      t("finance.ledgerReports.statementTables.fundName"),
      t("finance.ledgerReports.statementTables.restriction"),
      t("finance.ledgerReports.statementTables.balanceAt", { date: statement.from }),
      t("finance.ledgerReports.statementTables.revenue"),
      t("finance.ledgerReports.statementTables.expenses"),
      t("finance.ledgerReports.statementTables.transfersReleases"),
      t("finance.ledgerReports.statementTables.balanceAt", { date: statement.to }),
    ],
    ...statement.funds.map((f) => [
      f.code,
      f.name,
      t(FUND_RESTRICTION_KEY[f.restriction]),
      money(f.opening_cents),
      money(f.revenue_cents),
      money(f.expenses_cents),
      money(f.transfers_cents),
      money(f.closing_cents),
    ]),
    [
      "",
      t("finance.ledgerReports.statementTables.allFunds"),
      "",
      money(statement.totals.opening_cents),
      money(statement.totals.revenue_cents),
      money(statement.totals.expenses_cents),
      money(statement.totals.transfers_cents),
      money(statement.totals.closing_cents),
    ],
  ];
  return csvDocument(rows);
}
