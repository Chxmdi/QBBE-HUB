/**
 * Journal entries posted by another record (a gift, a bill, a payment...) are
 * undone from that record, never reversed in the ledger directly: the record
 * would otherwise still look live while the ledger said it was undone. The
 * database enforces this (app.guard_source_entry_reversal); this tells the
 * entry page which records those are and where each one is undone.
 */

/** Source types whose entry is undone only from the record that posted it. */
export const UNDONE_FROM_SOURCE = new Set([
  "gift",
  "finance_bill",
  "finance_invoice",
  "finance_payment",
  "payroll_run",
  "sales_tax_period",
]);

export interface PaymentDocument {
  bill_id: string | null;
  invoice_id: string | null;
}

/** Where the record behind an entry is opened, or null when it has no page. */
export function sourceRecordHref(
  sourceType: string | null,
  sourceId: string | null,
  payment?: PaymentDocument | null,
): string | null {
  if (!sourceType || !sourceId) return null;
  switch (sourceType) {
    case "gift":
      return `/finance/gifts/${sourceId}`;
    case "finance_bill":
      return `/finance/payables/bills/${sourceId}`;
    case "finance_invoice":
      return `/finance/payables/invoices/${sourceId}`;
    case "finance_payment":
      if (payment?.bill_id) return `/finance/payables/bills/${payment.bill_id}`;
      if (payment?.invoice_id) return `/finance/payables/invoices/${payment.invoice_id}`;
      return null;
    case "payroll_run":
      return `/finance/payroll/${sourceId}`;
    case "sales_tax_period":
      return "/finance/sales-tax";
    default:
      return null;
  }
}
