import type { Locale } from "@/lib/i18n/config";
import { formatCurrency } from "@/lib/i18n/format";

/**
 * Money for the finance screens (#142). Amounts live in integer cents end to
 * end; floats never touch a stored figure.
 */

/**
 * "42.18", "42,18", "$1,234.56", "1 234,56 $" → cents. Returns null for
 * anything that is not a non-negative amount with at most two decimals, so a
 * typo is refused rather than silently rounded.
 */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[\s\u00a0\u202f$]/g, "");
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
    // Otherwise at most one separator, followed by one or two digits. "4.567"
    // or "1,234" could mean either thing, so they are refused, not guessed.
    const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
    if (!plain) return null;
    whole = plain[1];
    fraction = plain[2] ?? "";
  }
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "$1,234.56" in English, "1 234,56 $" in French (#141). */
export function formatCents(cents: number, locale: Locale = "en"): string {
  return formatCurrency(cents / 100, locale);
}

/** Plain decimal for spreadsheets: 4218 → "42.18". */
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
