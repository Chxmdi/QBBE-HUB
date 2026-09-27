import { centsToDecimal, csvField } from "@/features/finance/money";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

/**
 * The reconciliation report for the accountant (#151): the statement's
 * balances, the ledger's, what explains the gap between them, and every line
 * behind the figures. Amounts are plain decimals so a spreadsheet adds them.
 */

export interface ReportInput {
  organizationName: string;
  accountLabel: string;
  ledgerAccountLabel: string;
  statementStart: string;
  statementEnd: string;
  status: "open" | "reconciled";
  reconciledAt: string | null;
  openingCents: number;
  closingCents: number;
  figures: {
    statement_lines_cents: number;
    statement_gap_cents: number;
    ledger_balance_cents: number;
    cleared_balance_cents: number;
    outstanding_cents: number;
    unmatched_count: number;
    difference_cents: number;
  };
  lines: {
    posted_on: string;
    description: string;
    reference: string | null;
    amount_cents: number;
    entry_number: number | null;
    entry_date: string | null;
    match_method: string | null;
  }[];
  outstanding: { entry_date: string; entry_number: number; memo: string; amount_cents: number }[];
}

/**
 * An amount cell. csvField would prefix a negative amount with a quote (it
 * guards against formulas starting with "-"), so a spreadsheet would read
 * text. A value that is only digits, a minus and a decimal point cannot be a
 * formula, so it is written as is.
 */
class Amount {
  constructor(readonly text: string) {}
}
const amount = (cents: number) => new Amount(centsToDecimal(cents));
type Cell = string | number | null | Amount;
const cellText = (c: Cell) => (c instanceof Amount ? c.text : csvField(c));

const METHODS = ["suggested", "manual", "created"] as const;

/**
 * Labels follow the requester's language (#141); amounts stay plain decimals
 * and dates stay ISO so a spreadsheet reads them the same in either language.
 */
export function reconciliationCsv(r: ReportInput, t: TranslateFn = createTranslator("en")): string {
  const method = (m: string | null) =>
    m === null
      ? t("finance.bank.csv.methods.none")
      : (METHODS as readonly string[]).includes(m)
        ? t(`finance.bank.csv.methods.${m as (typeof METHODS)[number]}`)
        : m;
  const rows: Cell[][] = [
    [t("finance.bank.csv.title"), r.organizationName],
    [t("finance.bank.csv.bankAccount"), r.accountLabel],
    [t("finance.bank.csv.ledgerAccount"), r.ledgerAccountLabel],
    [t("finance.bank.csv.period"), t("finance.bank.period", { start: r.statementStart, end: r.statementEnd })],
    [
      t("finance.bank.csv.status"),
      r.status === "reconciled"
        ? t("finance.bank.csv.statusReconciled", { date: r.reconciledAt ?? "" }).trim()
        : t("finance.bank.csv.statusOpen"),
    ],
    [],
    [t("finance.bank.csv.summary"), t("finance.bank.csv.amount")],
    [t("finance.bank.csv.opening"), amount(r.openingCents)],
    [t("finance.bank.csv.lines"), amount(r.figures.statement_lines_cents)],
    [t("finance.bank.csv.closing"), amount(r.closingCents)],
    [t("finance.bank.csv.gap"), amount(r.figures.statement_gap_cents)],
    [t("finance.bank.csv.ledger"), amount(r.figures.ledger_balance_cents)],
    [t("finance.bank.csv.outstanding"), amount(r.figures.outstanding_cents)],
    [t("finance.bank.csv.cleared"), amount(r.figures.cleared_balance_cents)],
    [t("finance.bank.csv.difference"), amount(r.figures.difference_cents)],
    [t("finance.bank.csv.unmatched"), r.figures.unmatched_count],
    [],
    [t("finance.bank.csv.linesHeading")],
    [
      t("finance.bank.csv.date"),
      t("finance.bank.csv.description"),
      t("finance.bank.csv.reference"),
      t("finance.bank.csv.amount"),
      t("finance.bank.csv.ledgerEntry"),
      t("finance.bank.csv.entryDate"),
      t("finance.bank.csv.match"),
    ],
    ...r.lines.map((l) => [
      l.posted_on,
      l.description,
      l.reference,
      amount(l.amount_cents),
      l.entry_number,
      l.entry_date,
      method(l.match_method),
    ]),
    [],
    [t("finance.bank.csv.outstandingHeading")],
    [t("finance.bank.csv.date"), t("finance.bank.csv.ledgerEntry"), t("finance.bank.csv.memo"), t("finance.bank.csv.amount")],
    ...r.outstanding.map((o) => [o.entry_date, o.entry_number, o.memo, amount(o.amount_cents)]),
  ];
  return `\uFEFF${rows.map((row) => row.map(cellText).join(",")).join("\r\n")}\r\n`;
}
