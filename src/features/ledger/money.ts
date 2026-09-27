import type { Locale } from "@/lib/i18n/config";
import { formatCurrency } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Money and labels for the general ledger (#148). Amounts are integer cents
 * end to end; floats never touch a stored figure.
 */

/**
 * "42.18", "42,18", "$1,234.56", "1 234,56 $" → cents. Returns null for
 * anything that is not a non-negative amount with at most two decimals, so a
 * typo is refused rather than silently rounded.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[\s  $]/g, "");
  if (cleaned === "") return null;
  let whole: string;
  let fraction = "";
  // Both "." and "," present: the last one is the decimal point and the other
  // may only group thousands ("1,234.56", "1.234,56").
  const grouped = /^(\d{1,3}(?:([.,])\d{3})+)([.,])(\d{1,2})$/.exec(cleaned);
  if (grouped && grouped[2] !== grouped[3]) {
    whole = grouped[1].replace(/[.,]/g, "");
    fraction = grouped[4];
  } else {
    // Otherwise at most one separator followed by one or two digits. "4.567"
    // or "1,234" could mean either thing, so they are refused, not guessed.
    const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
    if (!plain) return null;
    whole = plain[1];
    fraction = plain[2] ?? "";
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * "$1,234.56" in English, "1 234,56 $" in French (#141). Pass the reader's
 * language; English is the default so spreadsheets and logs stay stable.
 */
export function formatCents(cents: number, locale: Locale = "en"): string {
  return formatCurrency(cents / 100, locale);
}

/**
 * A balance stored as debits minus credits, shown the way an accountant reads
 * it: "$1,200.00 Dr" or "$300.00 Cr" — in French "1 200,00 $ Dt" or
 * "300,00 $ Ct". Zero has no side.
 */
export function formatBalance(cents: number, locale: Locale = "en"): string {
  if (cents === 0) return formatCents(0, locale);
  const side =
    locale === "fr-CA" ? (cents > 0 ? "Dt" : "Ct") : cents > 0 ? "Dr" : "Cr";
  return `${formatCents(Math.abs(cents), locale)} ${side}`;
}

/** Plain decimal for spreadsheets: 4218 → "42.18", -5 → "-0.05". */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** One CSV field, quoted when it needs to be; formula-leading text is neutralised. */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A leading =, +, - or @ would be run as a formula by Excel (CSV injection).
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV document as Excel reads it: byte-order mark, CRLF line ends. */
export function csvDocument(rows: (string | number | null | undefined)[][]): string {
  return `﻿${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}

export const ACCOUNT_TYPES = ["asset", "liability", "net_assets", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  net_assets: "Net assets",
  revenue: "Revenue",
  expense: "Expense",
};

/** The catalogue key for each account type, for `t()` (#141). */
export const ACCOUNT_TYPE_KEY: Record<AccountType, MessageKey> = {
  asset: "finance.common.accountTypes.asset",
  liability: "finance.common.accountTypes.liability",
  net_assets: "finance.common.accountTypes.net_assets",
  revenue: "finance.common.accountTypes.revenue",
  expense: "finance.common.accountTypes.expense",
};

export const FUND_RESTRICTIONS = [
  "unrestricted",
  "internally_restricted",
  "externally_restricted",
] as const;
export type FundRestriction = (typeof FUND_RESTRICTIONS)[number];

export const FUND_RESTRICTION_LABEL: Record<FundRestriction, string> = {
  unrestricted: "Unrestricted",
  internally_restricted: "Internally restricted",
  externally_restricted: "Externally restricted",
};

export const FUND_RESTRICTION_KEY: Record<FundRestriction, MessageKey> = {
  unrestricted: "finance.common.fundRestrictions.unrestricted",
  internally_restricted: "finance.common.fundRestrictions.internally_restricted",
  externally_restricted: "finance.common.fundRestrictions.externally_restricted",
};

export const ENTRY_KIND_LABEL: Record<string, string> = {
  standard: "Journal entry",
  opening: "Opening balances",
  reversal: "Reversal",
  closing: "Year-end closing",
};

export const ENTRY_KIND_KEY: Record<string, MessageKey> = {
  standard: "finance.common.entryKinds.standard",
  opening: "finance.common.entryKinds.opening",
  reversal: "finance.common.entryKinds.reversal",
  closing: "finance.common.entryKinds.closing",
};

/** Debits and credits of a set of lines, and whether they balance. */
export function lineTotals(lines: { debit: number; credit: number }[]) {
  const debit = lines.reduce((sum, l) => sum + l.debit, 0);
  const credit = lines.reduce((sum, l) => sum + l.credit, 0);
  return { debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0 };
}
