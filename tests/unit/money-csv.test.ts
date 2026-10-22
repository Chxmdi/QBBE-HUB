import { describe, expect, it } from "vitest";
import * as finance from "@/features/finance/money";
import * as ledger from "@/features/ledger/money";

// Finance spreadsheets: a negative amount must stay a number so SUM() counts
// it, while text that would run as a formula is still neutralised.
describe.each([
  ["finance", finance],
  ["ledger", ledger],
])("%s csvField", (_name, money) => {
  it("leaves negative amounts as numbers", () => {
    expect(money.csvField(money.centsToDecimal(-12000))).toBe("-120.00");
    expect(money.csvField(money.centsToDecimal(-5))).toBe("-0.05");
    expect(money.csvField("-7")).toBe("-7");
    expect(money.csvField(money.centsToDecimal(4218))).toBe("42.18");
  });

  it("still neutralises anything that is not a plain number", () => {
    for (const formula of ["-1+1", "=cmd|' /C calc'!A0", "+1", "+12.50", "@SUM(A1)", "-A1", "-1,5", "-.5", "-1e3", "\t-1"]) {
      expect(money.csvField(formula).replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    }
  });
});
