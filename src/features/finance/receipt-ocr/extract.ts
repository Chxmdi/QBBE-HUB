/**
 * Receipt reading, v2 of #142: turns the text the in-browser OCR engine read
 * off a photo into suggestions for the submit form.
 *
 * Everything here is pure and runs on plain text, so it is tested without the
 * OCR engine (see extract.test.ts). The rule throughout is the one the money
 * parser already follows: when a value could be read two ways, it is left out
 * rather than guessed. An empty field costs the submitter a few keystrokes; a
 * wrong figure that looks filled in can reach the accountant unnoticed.
 */

import { parseMoneyToCents } from "@/features/finance/money";

export type ReceiptSuggestions = {
  /** YYYY-MM-DD */
  documentDate?: string;
  vendor?: string;
  totalCents?: number;
  gstCents?: number;
  qstCents?: number;
};

export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;

/** Uppercase, accents removed, so "Total à payer" and "TOTAL A PAYER" match alike. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function linesOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[\t  ]/g, " ").replace(/ {2,}/g, " ").trim())
    .filter(Boolean);
}

/** Tax rates ("5 %", "9,975%") must never be read as amounts. */
function withoutPercentages(line: string): string {
  return line.replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
}

function percentagesIn(line: string): number[] {
  return [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(",", ".")));
}

/**
 * Every amount on a line, in cents, left to right. Receipts always print
 * cents, so only figures with exactly two decimals count; that keeps
 * quantities, item codes and phone numbers out. Negative figures (discounts,
 * refunds) are skipped. Spaces group thousands only in the French form with a
 * decimal comma ("1 234,56"): in "2 12.50" the 2 is a quantity.
 */
export function amountsIn(line: string): number[] {
  const text = withoutPercentages(line);
  const pattern =
    /(-\s*)?(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})(?![\d])/g;
  const out: number[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m[1]) continue;
    const cents = parseMoneyToCents(m[2]);
    if (cents !== null) out.push(cents);
  }
  return out;
}

// ---------------------------------------------------------------- total

const SUBTOTAL = /\b(SOUS[- ]?TOTAL|SUB[- ]?TOTAL|S\/TOTAL|STOTAL)\b/;
const TOTAL = /\b(TOTAL|MONTANT|AMOUNT DUE|BALANCE DUE|A PAYER)\b/;
// Lines that carry a total-like word but are not the amount paid.
const NOT_TOTAL =
  /\b(TPS|TVQ|GST|QST|HST|TVH|TAXES?|ARTICLES?|ITEMS?|RECU|RECEIVED|TENDERED|REMIS|MONNAIE|CHANGE|COMPTANT|CASH|ECONOMIES|SAVINGS|RABAIS|POINTS)\b/;

function subtotalOf(lines: string[]): number | undefined {
  const values = new Set<number>();
  lines.forEach((line, i) => {
    const folded = fold(line);
    if (!SUBTOTAL.test(folded)) return;
    const amounts = amountsIn(line);
    const value = amounts.at(-1) ?? amountsIn(lines[i + 1] ?? "").at(-1);
    if (value !== undefined) values.add(value);
  });
  return values.size === 1 ? [...values][0] : undefined;
}

/**
 * The amount paid: the largest amount beside a TOTAL / MONTANT / TOTAL À
 * PAYER word. The largest, because a tip is added after the first "Total"
 * and the grand total below it is what left the account. Subtotals, tax
 * totals and cash tendered are not candidates.
 */
function totalOf(lines: string[]): number | undefined {
  const candidates: number[] = [];
  lines.forEach((line, i) => {
    const folded = fold(line);
    if (!TOTAL.test(folded) || SUBTOTAL.test(folded) || NOT_TOTAL.test(folded)) return;
    const amounts = amountsIn(line);
    // OCR sometimes puts a right-aligned amount on its own line.
    const value = amounts.at(-1) ?? amountsIn(lines[i + 1] ?? "").at(-1);
    if (value !== undefined && value > 0) candidates.push(value);
  });
  return candidates.length ? Math.max(...candidates) : undefined;
}

// ---------------------------------------------------------------- taxes

const GST_WORD = /\b(TPS|GST)\b/;
const QST_WORD = /\b(TVQ|QST)\b/;

/**
 * One tax: the amount on the lines that name it. A line naming both taxes
 * ("TPS/TVQ incluses") says nothing about either. A line whose percentage is
 * not the expected rate is someone else's tax. Several different amounts are
 * settled by the rate against the subtotal, or not at all.
 */
function taxOf(
  lines: string[],
  word: RegExp,
  otherWord: RegExp,
  rate: number,
  subtotal: number | undefined,
): number | undefined {
  const values = new Set<number>();
  for (const line of lines) {
    const folded = fold(line);
    if (!word.test(folded) || otherWord.test(folded)) continue;
    const rates = percentagesIn(line);
    if (rates.length && !rates.some((r) => Math.abs(r - rate * 100) < 0.01)) continue;
    const amounts = amountsIn(line);
    if (!amounts.length) continue;
    // "TPS sur 40,00 : 2,00" - the base and the tax share a line; the tax is
    // the one that is the rate of another figure there, otherwise the last.
    const byRate = amounts.find((a) => amounts.some((b) => b !== a && Math.abs(Math.round(b * rate) - a) <= 2));
    values.add(byRate ?? amounts.at(-1)!);
  }
  const found = [...values].filter((v) => v > 0);
  if (found.length === 1) return found[0];
  if (found.length > 1 && subtotal !== undefined) {
    const matching = found.filter((v) => Math.abs(Math.round(subtotal * rate) - v) <= 2);
    if (matching.length === 1) return matching[0];
  }
  return undefined;
}

// ---------------------------------------------------------------- date

const MONTHS: Record<string, number> = {
  JAN: 1, JANV: 1, JANUARY: 1, JANVIER: 1,
  FEB: 2, FEV: 2, FEVR: 2, FEBRUARY: 2, FEVRIER: 2,
  MAR: 3, MARS: 3, MARCH: 3,
  APR: 4, AVR: 4, APRIL: 4, AVRIL: 4,
  MAY: 5, MAI: 5,
  JUN: 6, JUNE: 6, JUIN: 6,
  JUL: 7, JULY: 7, JUIL: 7, JUILLET: 7,
  AUG: 8, AUGUST: 8, AOU: 8, AOUT: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9, SEPTEMBRE: 9,
  OCT: 10, OCTOBER: 10, OCTOBRE: 10,
  NOV: 11, NOVEMBER: 11, NOVEMBRE: 11,
  DEC: 12, DECEMBER: 12, DECEMBRE: 12,
};
const MONTH_WORD = `(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})\\.?`;

function isoDate(year: number, month: number, day: number): string | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return undefined; // 31 September
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datesIn(line: string): string[] {
  const folded = fold(line);
  const out: (string | undefined)[] = [];
  // 2026-09-26, 2026/09/26
  for (const m of folded.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    out.push(isoDate(+m[1], +m[2], +m[3]));
  }
  // 26/09/2026 or 09/26/2026: whichever reading is the only valid one.
  // 05/09/2026 reads both ways and is left out.
  for (const m of folded.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/g)) {
    const a = +m[1];
    const b = +m[2];
    const dayFirst = isoDate(+m[3], b, a);
    const monthFirst = isoDate(+m[3], a, b);
    if (dayFirst && monthFirst && dayFirst !== monthFirst) continue;
    out.push(dayFirst ?? monthFirst);
  }
  // 26 sept. 2026, 1er octobre 2026, 26 Sep 2026
  for (const m of folded.matchAll(new RegExp(`\\b(\\d{1,2})(?:ER)?\\s+${MONTH_WORD}\\s*,?\\s*(20\\d{2})\\b`, "g"))) {
    out.push(isoDate(+m[3], MONTHS[m[2]], +m[1]));
  }
  // Sep 26 2026, September 26, 2026
  for (const m of folded.matchAll(new RegExp(`\\b${MONTH_WORD}\\s+(\\d{1,2})\\s*,?\\s*(20\\d{2})\\b`, "g"))) {
    out.push(isoDate(+m[3], MONTHS[m[1]], +m[2]));
  }
  return out.filter((d): d is string => Boolean(d));
}

function dateOf(lines: string[], today: string): string | undefined {
  const found = new Set(lines.flatMap(datesIn).filter((d) => d <= today));
  // Two different dates (a sale and a return-by date, say) - no guess.
  return found.size === 1 ? [...found][0] : undefined;
}

// ---------------------------------------------------------------- vendor

const NOT_VENDOR =
  /\b(BIENVENUE|WELCOME|MERCI|THANK|RECU|RECEIPT|FACTURE|INVOICE|TEL|PHONE|TELEPHONE|WWW|HTTPS?|COPIE|COPY|CLIENT|CUSTOMER|CAISSE|CASHIER|DATE|HEURE|TIME)\b/;
// "1234 rue Sainte-Catherine", "55 Main St": a number then a word is an
// address ("7-Eleven" has no space). "H2X 1Y4" is a postal code.
const ADDRESS = /^\d+[A-Z]?,?\s|\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/;

/** The first line that reads as a name: letters, not an address, date, greeting or phone. */
function vendorOf(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 8)) {
    const folded = fold(line);
    const letters = (folded.match(/[A-Z]/g) ?? []).length;
    if (letters < 3 || letters / folded.replace(/\s/g, "").length < 0.6) continue;
    if (NOT_VENDOR.test(folded) || ADDRESS.test(folded)) continue;
    if (datesIn(line).length || amountsIn(line).length) continue;
    const name = line.replace(/^[^\p{L}\d]+|[^\p{L}\d.)]+$/gu, "").trim();
    if (name.length >= 3) return name.slice(0, 200);
  }
  return undefined;
}

// ---------------------------------------------------------------- all

export function extractReceiptFields(text: string, today: string): ReceiptSuggestions {
  const lines = linesOf(text);
  const subtotal = subtotalOf(lines);
  const gst = taxOf(lines, GST_WORD, QST_WORD, GST_RATE, subtotal);
  const qst = taxOf(lines, QST_WORD, GST_WORD, QST_RATE, subtotal);
  let total = totalOf(lines);
  // A "total" smaller than the subtotal or the taxes it includes is a
  // misread line, not the amount paid.
  if (total !== undefined) {
    if ((subtotal !== undefined && total < subtotal) || total < (gst ?? 0) + (qst ?? 0)) total = undefined;
  }
  const out: ReceiptSuggestions = {};
  const date = dateOf(lines, today);
  const vendor = vendorOf(lines);
  if (date) out.documentDate = date;
  if (vendor) out.vendor = vendor;
  if (total !== undefined) out.totalCents = total;
  if (gst !== undefined) out.gstCents = gst;
  if (qst !== undefined) out.qstCents = qst;
  return out;
}

/**
 * Whether the taxes typed or suggested agree with Quebec's rates on the
 * amount before tax (total minus both taxes), within two cents. Returns null
 * when there is nothing to compare: no total, or no tax at all.
 */
export function taxConsistency(
  totalCents: number | null,
  gstCents: number | null,
  qstCents: number | null,
): { consistent: boolean; beforeTaxCents: number; expectedGstCents: number; expectedQstCents: number } | null {
  if (totalCents === null || (!gstCents && !qstCents)) return null;
  const beforeTaxCents = totalCents - (gstCents ?? 0) - (qstCents ?? 0);
  if (beforeTaxCents <= 0) return null;
  const expectedGstCents = Math.round(beforeTaxCents * GST_RATE);
  const expectedQstCents = Math.round(beforeTaxCents * QST_RATE);
  const gstOk = !gstCents || Math.abs(gstCents - expectedGstCents) <= 2;
  const qstOk = !qstCents || Math.abs(qstCents - expectedQstCents) <= 2;
  return { consistent: gstOk && qstOk, beforeTaxCents, expectedGstCents, expectedQstCents };
}
