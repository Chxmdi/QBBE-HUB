import { centsToDecimal, csvField } from "@/features/finance/money";

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

export function reconciliationCsv(r: ReportInput): string {
  const rows: Cell[][] = [
    ["Bank reconciliation", r.organizationName],
    ["Bank account", r.accountLabel],
    ["Ledger account", r.ledgerAccountLabel],
    ["Statement period", `${r.statementStart} to ${r.statementEnd}`],
    ["Status", r.status === "reconciled" ? `Reconciled ${r.reconciledAt ?? ""}`.trim() : "Open"],
    [],
    ["Summary", "Amount"],
    ["Statement opening balance", amount(r.openingCents)],
    ["Statement lines in period", amount(r.figures.statement_lines_cents)],
    ["Statement closing balance", amount(r.closingCents)],
    ["Statement lines not adding up (should be 0.00)", amount(r.figures.statement_gap_cents)],
    ["Ledger balance at statement end", amount(r.figures.ledger_balance_cents)],
    ["Less: outstanding ledger items", amount(r.figures.outstanding_cents)],
    ["Cleared ledger balance", amount(r.figures.cleared_balance_cents)],
    ["Difference (closing balance less cleared ledger balance)", amount(r.figures.difference_cents)],
    ["Statement lines not matched", r.figures.unmatched_count],
    [],
    ["Statement lines"],
    ["Date", "Description", "Reference", "Amount", "Ledger entry", "Entry date", "Match"],
    ...r.lines.map((l) => [
      l.posted_on,
      l.description,
      l.reference,
      amount(l.amount_cents),
      l.entry_number,
      l.entry_date,
      l.match_method ?? "not matched",
    ]),
    [],
    ["Outstanding ledger items (in the ledger, not yet at the bank)"],
    ["Date", "Ledger entry", "Memo", "Amount"],
    ...r.outstanding.map((o) => [o.entry_date, o.entry_number, o.memo, amount(o.amount_cents)]),
  ];
  return `﻿${rows.map((row) => row.map(cellText).join(",")).join("\r\n")}\r\n`;
}
