import { describe, expect, it } from "vitest";
import { invoiceTaxDefaults, invoiceTaxProblem, NOT_REGISTERED, type TaxRegistration } from "@/features/payables/invoice-tax";

const REGISTERED: TaxRegistration = {
  gstRegistered: true,
  gstNumber: "123456789RT0001",
  qstRegistered: true,
  qstNumber: "1234567890TQ0001",
  gstRate: "5.00000",
  qstRate: "9.97500",
};

describe("invoice GST and QST", () => {
  it("works the tax out from the amount before tax, QST not on GST", () => {
    expect(invoiceTaxDefaults(10000, REGISTERED)).toEqual({ gst: 500, qst: 998 });
    // 9.975 % of 12.34 is 1.230915: rounds to 1.23.
    expect(invoiceTaxDefaults(1234, REGISTERED)).toEqual({ gst: 62, qst: 123 });
  });

  it("charges nothing for a tax the organization is not registered for", () => {
    expect(invoiceTaxDefaults(10000, NOT_REGISTERED)).toEqual({ gst: 0, qst: 0 });
    expect(invoiceTaxDefaults(10000, { ...REGISTERED, qstRegistered: false })).toEqual({ gst: 500, qst: 0 });
  });

  it("refuses tax while not registered, and more than the rate gives", () => {
    expect(invoiceTaxProblem(10000, 500, 0, NOT_REGISTERED)).toBe("gstNotRegistered");
    expect(invoiceTaxProblem(10000, 0, 998, { ...REGISTERED, qstRegistered: false })).toBe("qstNotRegistered");
    expect(invoiceTaxProblem(10000, 502, 998, REGISTERED)).toBe("gstMismatch");
    expect(invoiceTaxProblem(10000, 500, 1000, REGISTERED)).toBe("qstMismatch");
    expect(invoiceTaxProblem(10000, 501, 997, REGISTERED)).toBeNull();
    // Half the invoice exempt: less tax than the full rate is fine.
    expect(invoiceTaxProblem(10000, 250, 499, REGISTERED)).toBeNull();
    expect(invoiceTaxProblem(10000, 0, 0, REGISTERED)).toBeNull();
    expect(invoiceTaxProblem(10000, 0, 0, NOT_REGISTERED)).toBeNull();
  });
});
