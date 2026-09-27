/**
 * GST/QST return worksheet rules (#152).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ NEEDS ACCOUNTANT REVIEW. Everything that decides which figure goes   │
 * │ on which return line, and the rebate percentages, is in this file    │
 * │ and nowhere else. Change it here, and the screens, the CSV export    │
 * │ and the tests follow.                                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * In Quebec, Revenu Québec administers both taxes for most organizations and
 * both are reported on one return (FPZ-500): the GST part uses the federal
 * line numbers (101 to 109 of the GST/HST return) and the QST part the 200
 * series. This worksheet only prepares figures; nothing is filed from the app.
 *
 * Inputs are the totals the database returns per direction and tax code
 * (`sales_tax_totals`). All amounts are integer cents.
 *
 * Assumptions to confirm:
 *   1. Line 101 (sales and other revenue) counts standard-rated and
 *      zero-rated sales, and leaves out exempt and out-of-scope amounts
 *      (grants, donations, exempt memberships). See LINE_101_CODES.
 *   2. Adjustments (lines 104/107 and 204/207) are always zero in v1: bad
 *      debts, change-of-use and other adjustments are entered by the
 *      accountant on the return itself.
 *   3. Input tax credits and refunds are what each purchase line claims; the
 *      claimable share for an organization with exempt activities is set in
 *      the tax settings (itc_claim_bp) and applied when lines are recorded.
 *   4. The regular method only. The quick method and special quick method are
 *      not supported.
 *   5. Public service body rebate: QBBE is a non-profit organization, not a
 *      registered charity. A non-profit qualifies only if at least 40 % of its
 *      funding comes from government ("qualifying non-profit organization").
 *      The rebate is on tax paid that was NOT claimed back. Percentages below.
 *      CONFIRM ELIGIBILITY WITH YOUR ACCOUNTANT before using the rebate figures.
 */

export const TAX_CODES = ["standard", "zero_rated", "exempt", "out_of_scope"] as const;
export type TaxCode = (typeof TAX_CODES)[number];

export const TAX_CODE_LABEL: Record<TaxCode, string> = {
  standard: "Standard-rated",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
  out_of_scope: "Out of scope",
};

export const TAX_CODE_HELP: Record<TaxCode, string> = {
  standard: "Taxable at the GST and QST rates.",
  zero_rated: "Taxable at 0 %. Counts as a taxable supply; no tax charged.",
  exempt: "No tax, and no credit for the tax paid to make it.",
  out_of_scope: "Not a supply at all, for example a grant or a donation.",
};

export type Direction = "sale" | "purchase";

export const FILING_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;
export type FilingFrequency = (typeof FILING_FREQUENCIES)[number];

export const FILING_FREQUENCY_LABEL: Record<FilingFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** One row of `sales_tax_totals`. */
export interface TaxTotalsRow {
  direction: Direction;
  tax_code: TaxCode;
  line_count: number;
  amount_cents: number;
  gst_cents: number;
  qst_cents: number;
  itc_cents: number;
  itr_cents: number;
}

/**
 * Tax on an amount at a percent rate given as a decimal string ("9.975"),
 * rounded to the nearest cent with half a cent rounding up. Integer
 * arithmetic only: the rate is scaled to hundred-thousandths of a percent.
 * Mirrors `app.sales_tax_amount` in the database, which is authoritative.
 */
export function taxOnAmount(amountCents: number, ratePercent: string): number {
  const match = /^(\d{1,2})(?:\.(\d{1,5}))?$/.exec(ratePercent);
  if (!match || !Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("taxOnAmount: invalid amount or rate");
  }
  // 9.975 % → 997500 hundred-thousandths of a percent.
  const scaledRate = Number(match[1]) * 100000 + Number((match[2] ?? "").padEnd(5, "0"));
  const denominator = 100 * 100000;
  const product = BigInt(amountCents) * BigInt(scaledRate);
  const quotient = product / BigInt(denominator);
  const remainder = product % BigInt(denominator);
  return Number(remainder * 2n >= BigInt(denominator) ? quotient + 1n : quotient);
}

/** Share of an amount in basis points (10000 = all), half a cent rounding up. */
export function shareOf(cents: number, basisPoints: number): number {
  const product = BigInt(cents) * BigInt(basisPoints);
  const quotient = product / 10000n;
  return Number((product % 10000n) * 2n >= 10000n ? quotient + 1n : quotient);
}

// ---------------------------------------------------------------------------
// Return-line mapping
// ---------------------------------------------------------------------------

/** Sales counted on line 101. Assumption 1 above. */
export const LINE_101_CODES: readonly TaxCode[] = ["standard", "zero_rated"];

/** Which lines of the period feed a return line, for the drill-down. */
export interface LineSource {
  direction: Direction;
  codes: readonly TaxCode[];
}

export interface ReturnLine {
  line: string;
  label: string;
  cents: number;
  /** Absent for lines that are sums of other lines, or always zero in v1. */
  source?: LineSource;
  /** A total the filer copies from another line. */
  isTotal?: boolean;
}

function sum(rows: TaxTotalsRow[], pick: (r: TaxTotalsRow) => number, where: (r: TaxTotalsRow) => boolean) {
  return rows.filter(where).reduce((total, r) => total + pick(r), 0);
}

const sales = (codes: readonly TaxCode[]) => (r: TaxTotalsRow) =>
  r.direction === "sale" && codes.includes(r.tax_code);
const purchases = (r: TaxTotalsRow) => r.direction === "purchase";

export function gstReturnLines(rows: TaxTotalsRow[]): ReturnLine[] {
  const line101 = sum(rows, (r) => r.amount_cents, sales(LINE_101_CODES));
  const line103 = sum(rows, (r) => r.gst_cents, (r) => r.direction === "sale");
  const line104 = 0;
  const line105 = line103 + line104;
  const line106 = sum(rows, (r) => r.itc_cents, purchases);
  const line107 = 0;
  const line108 = line106 + line107;
  return [
    { line: "101", label: "Sales and other revenue", cents: line101, source: { direction: "sale", codes: LINE_101_CODES } },
    { line: "103", label: "GST collected or collectible", cents: line103, source: { direction: "sale", codes: ["standard"] } },
    { line: "104", label: "Adjustments to GST collected", cents: line104 },
    { line: "105", label: "Total GST and adjustments for the period (103 + 104)", cents: line105, isTotal: true },
    { line: "106", label: "Input tax credits (ITCs)", cents: line106, source: { direction: "purchase", codes: ["standard"] } },
    { line: "107", label: "Adjustments to ITCs", cents: line107 },
    { line: "108", label: "Total ITCs and adjustments (106 + 107)", cents: line108, isTotal: true },
    { line: "109", label: "Net tax (105 − 108). Negative is a refund.", cents: line105 - line108, isTotal: true },
  ];
}

export function qstReturnLines(rows: TaxTotalsRow[]): ReturnLine[] {
  const line203 = sum(rows, (r) => r.qst_cents, (r) => r.direction === "sale");
  const line204 = 0;
  const line205 = line203 + line204;
  const line206 = sum(rows, (r) => r.itr_cents, purchases);
  const line207 = 0;
  const line208 = line206 + line207;
  return [
    { line: "203", label: "QST collected or collectible", cents: line203, source: { direction: "sale", codes: ["standard"] } },
    { line: "204", label: "Adjustments to QST collected", cents: line204 },
    { line: "205", label: "Total QST and adjustments (203 + 204)", cents: line205, isTotal: true },
    { line: "206", label: "Input tax refunds (ITRs)", cents: line206, source: { direction: "purchase", codes: ["standard"] } },
    { line: "207", label: "Adjustments to ITRs", cents: line207 },
    { line: "208", label: "Total ITRs and adjustments (206 + 207)", cents: line208, isTotal: true },
    { line: "209", label: "Net tax (205 − 208). Negative is a refund.", cents: line205 - line208, isTotal: true },
  ];
}

/**
 * The two figures the closing entry posts per tax. The database computes the
 * same sums in `sales_tax_close_period`; a test keeps them in step.
 */
export function closingFigures(rows: TaxTotalsRow[]) {
  const gst = gstReturnLines(rows);
  const qst = qstReturnLines(rows);
  const find = (lines: ReturnLine[], n: string) => lines.find((l) => l.line === n)?.cents ?? 0;
  return {
    gstCollected: find(gst, "105"),
    gstClaimed: find(gst, "108"),
    qstCollected: find(qst, "205"),
    qstClaimed: find(qst, "208"),
  };
}

// ---------------------------------------------------------------------------
// Public service body rebate (assumption 5)
// ---------------------------------------------------------------------------

/**
 * Rebate percentages for a charity or qualifying non-profit organization,
 * in basis points: GST 50 % (form GST66), QST 50 % (form VD-403). Other
 * public service bodies (municipalities, schools, hospitals) have other rates
 * and are not QBBE's case. CONFIRM WITH YOUR ACCOUNTANT.
 */
export const PSB_REBATE_BP = { gst: 5000, qst: 5000 } as const;

export interface RebateWorksheet {
  gstPaidNotClaimed: number;
  qstPaidNotClaimed: number;
  gstRebate: number;
  qstRebate: number;
}

/** Rebate on the tax paid on purchases that was not claimed back. */
export function psbRebate(rows: TaxTotalsRow[]): RebateWorksheet {
  const gstPaidNotClaimed = sum(rows, (r) => r.gst_cents - r.itc_cents, purchases);
  const qstPaidNotClaimed = sum(rows, (r) => r.qst_cents - r.itr_cents, purchases);
  return {
    gstPaidNotClaimed,
    qstPaidNotClaimed,
    gstRebate: shareOf(gstPaidNotClaimed, PSB_REBATE_BP.gst),
    qstRebate: shareOf(qstPaidNotClaimed, PSB_REBATE_BP.qst),
  };
}
