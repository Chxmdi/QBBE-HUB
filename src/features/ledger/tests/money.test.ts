import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  csvDocument,
  csvField,
  formatBalance,
  lineTotals,
  parseMoneyToCents,
} from "@/features/ledger/money";

describe("parseMoneyToCents", () => {
  it("reads the ways people type amounts", () => {
    expect(parseMoneyToCents("42.18")).toBe(4218);
    expect(parseMoneyToCents("42,18")).toBe(4218);
    expect(parseMoneyToCents("$1,234.56")).toBe(123456);
    expect(parseMoneyToCents("1 234,56 $")).toBe(123456);
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("7")).toBe(700);
    expect(parseMoneyToCents("0.5")).toBe(50);
  });

  it("refuses what it would have to guess", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("4.567")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("1,234")).toBeNull();
  });
});

describe("formatting", () => {
  it("shows balances with their side", () => {
    expect(formatBalance(120000)).toBe("$1,200.00 Dr");
    expect(formatBalance(-30000)).toBe("$300.00 Cr");
    expect(formatBalance(0)).toBe("$0.00");
  });

  it("writes plain decimals for spreadsheets", () => {
    expect(centsToDecimal(4218)).toBe("42.18");
    expect(centsToDecimal(-5)).toBe("-0.05");
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("neutralises formulas and quotes CSV fields", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField(-12)).toBe("-12");
    expect(csvField('Café, "Montréal"')).toBe('"Café, ""Montréal"""');
    expect(csvDocument([["a", 1]])).toBe("﻿a,1\r\n");
  });
});

describe("lineTotals", () => {
  it("balances only when debits equal credits and are not zero", () => {
    expect(lineTotals([{ debit: 500, credit: 0 }, { debit: 0, credit: 500 }]).balanced).toBe(true);
    expect(lineTotals([{ debit: 500, credit: 0 }, { debit: 0, credit: 499 }])).toEqual({
      debit: 500,
      credit: 499,
      difference: 1,
      balanced: false,
    });
    expect(lineTotals([]).balanced).toBe(false);
  });
});
