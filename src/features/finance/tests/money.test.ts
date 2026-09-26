import { describe, expect, it } from "vitest";
import { centsToDecimal, csvField, formatCents, parseMoneyToCents } from "../money";

describe("parseMoneyToCents", () => {
  // "4.567" and "1,234" are ambiguous between a decimal and a thousands
  // separator, so they are refused rather than guessed.
  it.each([
    ["42.18", 4218],
    ["42,18", 4218],
    ["42", 4200],
    ["42.5", 4250],
    ["$1,234.56", 123456],
    ["1 234,56 $", 123456],
    ["1.234,56", 123456],
    ["0", 0],
  ])("reads %s as %i cents", (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "-5", "4.567", "1,2,3", "12.3.4", "1,234", "1.234.567"])("refuses %j", (input) => {
    expect(parseMoneyToCents(input)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats cents as Canadian dollars", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });
  it("writes a plain decimal for spreadsheets", () => {
    expect(centsToDecimal(4218)).toBe("42.18");
    expect(centsToDecimal(5)).toBe("0.05");
  });
});

describe("csvField", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvField('Café "Chez Nous", Montréal')).toBe('"Café ""Chez Nous"", Montréal"');
  });
  it("neutralises text that Excel would run as a formula", () => {
    expect(csvField("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("leaves numbers and empty values alone", () => {
    expect(csvField(42)).toBe("42");
    expect(csvField(null)).toBe("");
  });
});
