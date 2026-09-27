import { describe, expect, it } from "vitest";
import {
  budgetReportCsv,
  evenSplit,
  fiscalMonths,
  fiscalYearLabel,
  formatPercent,
  netTotals,
  reportMonth,
  variance,
  type BudgetReportRow,
} from "@/features/budgets/budget";

describe("evenSplit", () => {
  it("spreads an amount over twelve months that add back up exactly", () => {
    expect(evenSplit(1200000)).toEqual(Array(12).fill(100000));
    const odd = evenSplit(100005);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(100005);
    expect(odd.slice(0, 9)).toEqual(Array(9).fill(8334));
    expect(odd.slice(9)).toEqual(Array(3).fill(8333));
    expect(evenSplit(0)).toEqual(Array(12).fill(0));
    expect(evenSplit(7)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });
});

describe("fiscal months", () => {
  it("runs twelve months across the calendar year end", () => {
    const months = fiscalMonths("2026-10-01");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-10");
    expect(months[3]).toBe("2027-01");
    expect(months[11]).toBe("2027-09");
    expect(fiscalMonths("2027-01-01")[11]).toBe("2027-12");
  });

  it("labels the fiscal year", () => {
    expect(fiscalYearLabel("2026-10-01")).toBe("FY 2026-27");
    expect(fiscalYearLabel("2099-04-01")).toBe("FY 2099-00");
    expect(fiscalYearLabel("2027-01-01")).toBe("FY 2027");
  });

  it("opens the report on a month inside the year", () => {
    expect(reportMonth("2026-10-01", "2026-12-14")).toBe("2026-12");
    expect(reportMonth("2026-10-01", "2026-09-26")).toBe("2026-10");
    expect(reportMonth("2026-10-01", "2028-01-01")).toBe("2027-09");
    expect(reportMonth("2026-10-01", "2026-12-14", "2027-03")).toBe("2027-03");
    expect(reportMonth("2026-10-01", "2026-12-14", "2030-03")).toBe("2026-12");
  });
});

describe("variance", () => {
  it("is positive when spending is under budget", () => {
    expect(variance("expense", 100000, 80000)).toEqual({ cents: 20000, percent: 20 });
    expect(variance("expense", 100000, 125000)).toEqual({ cents: -25000, percent: -25 });
  });

  it("is positive when revenue is above budget", () => {
    expect(variance("revenue", 100000, 110000)).toEqual({ cents: 10000, percent: 10 });
    expect(variance("revenue", 300000, 100000)).toEqual({ cents: -200000, percent: -66.7 });
  });

  it("has no percentage when nothing was budgeted", () => {
    expect(variance("expense", 0, 5000)).toEqual({ cents: -5000, percent: null });
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(12.5)).toBe("+12.5%");
    expect(formatPercent(-3)).toBe("-3.0%");
  });
});

const rows: BudgetReportRow[] = [
  {
    account_id: "a",
    code: "4200",
    name: "Donations",
    account_type: "revenue",
    annual_budget_cents: 600000,
    month_budget_cents: 50000,
    ytd_budget_cents: 100000,
    month_actual_cents: 0,
    ytd_actual_cents: 50000,
  },
  {
    account_id: "b",
    code: "5200",
    name: "Rent",
    account_type: "expense",
    annual_budget_cents: 1200000,
    month_budget_cents: 100000,
    ytd_budget_cents: 200000,
    month_actual_cents: 110000,
    ytd_actual_cents: 190000,
  },
];

describe("report totals and CSV", () => {
  it("nets revenue against expense", () => {
    expect(netTotals(rows)).toEqual({
      annual_budget_cents: -600000,
      month_budget_cents: -50000,
      ytd_budget_cents: -100000,
      month_actual_cents: -110000,
      ytd_actual_cents: -140000,
    });
  });

  it("writes one row per account, totals and the net", () => {
    const csv = budgetReportCsv(rows, { budget: "FY 2026-27 v1", month: "2026-11", filters: "All funds." });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Budget against actual: FY 2026-27 v1");
    expect(lines[4]).toContain("Month budget,Month actual,Month variance");
    expect(lines[5]).toBe("4200,Donations,Revenue,500.00,0.00,-500.00,-100.0,1000.00,500.00,-500.00,-50.0,6000.00");
    expect(lines[6]).toBe("5200,Rent,Expense,1000.00,1100.00,-100.00,-10.0,2000.00,1900.00,100.00,5.0,12000.00");
    expect(lines.at(-1)).toBe(
      ",Net (revenue less expense),,-500.00,-1100.00,-600.00,-120.0,-1000.00,-1400.00,-400.00,-40.0,-6000.00",
    );
  });
});
