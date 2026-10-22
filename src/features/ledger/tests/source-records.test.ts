import { describe, expect, it } from "vitest";
import { sourceRecordHref, UNDONE_FROM_SOURCE } from "@/features/ledger/source-records";

describe("entries undone from their own record", () => {
  it("names every record type the database guards", () => {
    expect([...UNDONE_FROM_SOURCE].sort()).toEqual(
      ["finance_bill", "finance_invoice", "finance_payment", "gift", "payroll_run", "sales_tax_period"],
    );
    // Bank matches and fund releases are still reversed in the ledger.
    expect(UNDONE_FROM_SOURCE.has("bank_transaction")).toBe(false);
    expect(UNDONE_FROM_SOURCE.has("fund_release")).toBe(false);
  });

  it("links each one to the page where it is voided or reversed", () => {
    expect(sourceRecordHref("gift", "g1")).toBe("/finance/gifts/g1");
    expect(sourceRecordHref("finance_bill", "b1")).toBe("/finance/payables/bills/b1");
    expect(sourceRecordHref("finance_invoice", "i1")).toBe("/finance/payables/invoices/i1");
    expect(sourceRecordHref("finance_payment", "p1", { bill_id: "b2", invoice_id: null })).toBe("/finance/payables/bills/b2");
    expect(sourceRecordHref("finance_payment", "p1", { bill_id: null, invoice_id: "i2" })).toBe("/finance/payables/invoices/i2");
    expect(sourceRecordHref("finance_payment", "p1", null)).toBeNull();
    expect(sourceRecordHref("payroll_run", "r1")).toBe("/finance/payroll/r1");
    expect(sourceRecordHref("sales_tax_period", "s1")).toBe("/finance/sales-tax");
    expect(sourceRecordHref(null, null)).toBeNull();
  });
});
