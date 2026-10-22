import { taxOnAmount } from "@/features/sales-tax/return-lines";

/**
 * GST and QST on a customer invoice. The tax is worked out from the amount
 * before tax at the rates in force, as the database does when the invoice is
 * posted (it refuses tax when the organization is not registered, or more
 * than this plus a cent of rounding; less is fine when part of the invoice is
 * exempt). QST is charged on the price before
 * GST, as it has been since 2013. An invoice may carry no tax (an exempt or
 * out-of-scope supply such as a grant).
 */

export interface TaxRegistration {
  gstRegistered: boolean;
  gstNumber: string | null;
  qstRegistered: boolean;
  qstNumber: string | null;
  /** Percent as a decimal string ("5.00000"), or null when unknown. */
  gstRate: string | null;
  qstRate: string | null;
}

export const NOT_REGISTERED: TaxRegistration = {
  gstRegistered: false,
  gstNumber: null,
  qstRegistered: false,
  qstNumber: null,
  gstRate: null,
  qstRate: null,
};

/** The tax an invoice should carry, in cents; zero for a tax not registered for. */
export function invoiceTaxDefaults(subtotalCents: number, reg: TaxRegistration): { gst: number; qst: number } {
  const safe = Number.isSafeInteger(subtotalCents) && subtotalCents > 0 ? subtotalCents : 0;
  return {
    gst: reg.gstRegistered && reg.gstRate ? taxOnAmount(safe, reg.gstRate) : 0,
    qst: reg.qstRegistered && reg.qstRate ? taxOnAmount(safe, reg.qstRate) : 0,
  };
}

export type InvoiceTaxProblem = "gstNotRegistered" | "qstNotRegistered" | "gstMismatch" | "qstMismatch";

/** Why the database would refuse this invoice's tax, or null when it is fine. */
export function invoiceTaxProblem(
  subtotalCents: number,
  gstCents: number,
  qstCents: number,
  reg: TaxRegistration,
): InvoiceTaxProblem | null {
  const expected = invoiceTaxDefaults(subtotalCents, reg);
  if (gstCents > 0 && !reg.gstRegistered) return "gstNotRegistered";
  if (qstCents > 0 && !reg.qstRegistered) return "qstNotRegistered";
  // Less tax than the rate gives is allowed: part of the invoice may be exempt.
  if (gstCents > 0 && reg.gstRate && gstCents > expected.gst + 1) return "gstMismatch";
  if (qstCents > 0 && reg.qstRate && qstCents > expected.qst + 1) return "qstMismatch";
  return null;
}
