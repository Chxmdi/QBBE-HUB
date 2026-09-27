import { describe, expect, it } from "vitest";
import {
  buildStatements,
  fiscalYearFor,
  fiscalYearsFromPeriods,
  isInvestmentIncomeAccount,
  journalImportCsv,
  operationsCsv,
  positionCsv,
  priorFiscalYear,
  returnFigures,
  sixMonthsAfter,
  trialBalanceImportCsv,
  type StatementTotalRow,
} from "@/features/ledger/year-end";

function row(partial: Partial<StatementTotalRow> & Pick<StatementTotalRow, "code" | "account_type">): StatementTotalRow {
  return {
    account_id: `acc-${partial.code}`,
    name: `Account ${partial.code}`,
    fund_id: "gen",
    fund_code: "GEN",
    fund_name: "General",
    restriction: "unrestricted",
    opening_cents: 0,
    movement_cents: 0,
    closing_movement_cents: 0,
    balance_cents: 0,
    ...partial,
  };
}

// A year: 1,000.00 donated and 300.00 rent in the general fund; a 500.00
// grant spent 200.00 in an externally restricted fund; the year then closed
// into 3000 and 3200. Opening: 50.00 cash against unrestricted net assets.
const YEAR: StatementTotalRow[] = [
  row({ code: "1000", account_type: "asset", opening_cents: 5000, movement_cents: 70000, balance_cents: 75000 }),
  row({ code: "1000", account_type: "asset", fund_id: "grant", restriction: "externally_restricted", movement_cents: 30000, balance_cents: 30000 }),
  row({ code: "3000", account_type: "net_assets", opening_cents: -5000, closing_movement_cents: -70000, balance_cents: -75000 }),
  row({ code: "3200", account_type: "net_assets", fund_id: "grant", restriction: "externally_restricted", closing_movement_cents: -30000, balance_cents: -30000 }),
  row({ code: "4200", name: "Donations", account_type: "revenue", movement_cents: -100000, closing_movement_cents: 100000 }),
  row({ code: "4010", name: "Government grants - Quebec", account_type: "revenue", fund_id: "grant", restriction: "externally_restricted", movement_cents: -50000, closing_movement_cents: 50000 }),
  row({ code: "5200", name: "Rent", account_type: "expense", movement_cents: 30000, closing_movement_cents: -30000 }),
  row({ code: "5200", name: "Rent", account_type: "expense", fund_id: "grant", restriction: "externally_restricted", movement_cents: 20000, closing_movement_cents: -20000 }),
];

describe("buildStatements", () => {
  const s = buildStatements(YEAR, "2025-10-01", "2026-09-30");

  it("reports operations by fund class, ignoring the closing entry", () => {
    expect(s.operations.totalRevenue).toEqual({ unrestricted: 100000, internally_restricted: 0, externally_restricted: 50000, total: 150000 });
    expect(s.operations.totalExpenses.total).toBe(50000);
    expect(s.operations.excess).toEqual({ unrestricted: 70000, internally_restricted: 0, externally_restricted: 30000, total: 100000 });
    expect(s.operations.expenses).toHaveLength(1);
    expect(s.operations.expenses[0].amounts.externally_restricted).toBe(20000);
  });

  it("balances the statement of financial position", () => {
    expect(s.position.totalAssets).toBe(105000);
    expect(s.position.totalLiabilities).toBe(0);
    expect(s.position.netAssets).toEqual({ unrestricted: 75000, internally_restricted: 0, externally_restricted: 30000, total: 105000 });
    expect(s.position.totalAssets).toBe(s.position.totalLiabilities + s.position.netAssets.total);
  });

  it("reconciles net assets: beginning plus excess plus direct entries equals ending", () => {
    expect(s.changes.beginning.total).toBe(5000);
    for (const k of ["unrestricted", "internally_restricted", "externally_restricted", "total"] as const) {
      expect(s.changes.beginning[k] + s.changes.excess[k] + s.changes.direct[k]).toBe(s.changes.ending[k]);
    }
  });

  it("gives the same net assets whether or not the year was closed", () => {
    // Without the closing entry, revenue and expenses still sit in their accounts.
    const unclosed = YEAR.map((r) => ({
      ...r,
      closing_movement_cents: 0,
      balance_cents:
        r.account_type === "revenue" || r.account_type === "expense"
          ? r.movement_cents
          : r.account_type === "net_assets"
            ? r.opening_cents
            : r.balance_cents,
    }));
    const u = buildStatements(unclosed, "2025-10-01", "2026-09-30");
    expect(u.position.netAssets).toEqual(s.position.netAssets);
    expect(u.operations.excess).toEqual(s.operations.excess);
  });

  it("is empty when nothing was posted", () => {
    expect(buildStatements([], "2024-10-01", "2025-09-30").empty).toBe(true);
    expect(s.empty).toBe(false);
  });
});

describe("CSV files", () => {
  const s = buildStatements(YEAR, "2025-10-01", "2026-09-30");

  it("labels the statements as prepared for the accountant, not filed", () => {
    expect(positionCsv(s, null)).toContain("Prepared for your accountant, not filed");
    expect(operationsCsv(s, null)).toContain("Prepared for your accountant, not filed");
  });

  it("adds a comparative column when there is a prior year", () => {
    const header = positionCsv(s, s).split("\r\n")[1];
    expect(header).toBe("Section,Account,Name,As at 2026-09-30,As at 2026-09-30");
    expect(operationsCsv(s, null)).toContain("Total revenue,1000.00,0.00,500.00,1500.00");
  });

  it("writes the general ledger in the generic import layout", () => {
    const csv = journalImportCsv([
      {
        entry_date: "2025-11-15",
        entry_number: 1,
        entry_kind: "standard",
        line_no: 1,
        account_code: "1000",
        account_name: "Bank - chequing",
        fund_code: "GEN",
        program_name: null,
        description: "=Donation, thanks",
        debit_cents: 100000,
        credit_cents: 0,
      },
    ]);
    const [header, line] = csv.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe("Date,Entry no,Account code,Account name,Fund,Program,Description,Debit,Credit");
    // Formula-leading text is neutralised and commas are quoted.
    expect(line).toBe(`2025-11-15,1,1000,Bank - chequing,GEN,,"'=Donation, thanks",1000.00,0.00`);
  });

  it("writes a trial balance with one row per non-zero account and no totals", () => {
    const csv = trialBalanceImportCsv([
      { code: "1000", name: "Bank", account_type: "asset", balance_cents: 105000 },
      { code: "3000", name: "Net assets", account_type: "net_assets", balance_cents: -105000 },
      { code: "4200", name: "Donations", account_type: "revenue", balance_cents: 0 },
    ]);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toEqual([
      "Account code,Account name,Type,Debit,Credit",
      "1000,Bank,asset,1050.00,0.00",
      "3000,Net assets,net_assets,0.00,1050.00",
    ]);
  });
});

describe("fiscal years", () => {
  it("runs twelve months from the first day", () => {
    expect(fiscalYearFor("2026-10-01")).toMatchObject({ startsOn: "2026-10-01", endsOn: "2027-09-30" });
    expect(fiscalYearFor("2027-03-01").endsOn).toBe("2028-02-29");
    expect(priorFiscalYear(fiscalYearFor("2026-10-01")).startsOn).toBe("2025-10-01");
  });

  it("derives years from the periods, newest first", () => {
    const periods = ["2025-10", "2025-11", "2026-10", "2027-09"].map((m) => ({
      starts_on: `${m}-01`,
      ends_on: `${m}-28`,
    }));
    expect(fiscalYearsFromPeriods(periods).map((y) => y.startsOn)).toEqual(["2026-10-01", "2025-10-01"]);
    expect(fiscalYearsFromPeriods([])).toEqual([]);
  });

  it("puts the usual return deadline six months after the year end", () => {
    expect(sixMonthsAfter("2027-09-30")).toBe("2028-03-31");
    expect(sixMonthsAfter("2027-03-31")).toBe("2027-09-30");
    expect(sixMonthsAfter("2027-12-31")).toBe("2028-06-30");
  });
});

describe("returns figures", () => {
  it("recognises investment income accounts in English and French", () => {
    expect(isInvestmentIncomeAccount("Interest income")).toBe(true);
    expect(isInvestmentIncomeAccount("Revenus d'intérêts")).toBe(true);
    expect(isInvestmentIncomeAccount("Rental income")).toBe(true);
    expect(isInvestmentIncomeAccount("Parent fees")).toBe(false);
    expect(isInvestmentIncomeAccount("Donations")).toBe(false);
  });

  it("flags the T1044 when a threshold is crossed and leaves the rest to the accountant", () => {
    const withInterest = [
      ...YEAR,
      row({ code: "4700", name: "Interest income", account_type: "revenue", movement_cents: -1_000_001, balance_cents: -1_000_001 }),
    ];
    const current = buildStatements(withInterest, "2025-10-01", "2026-09-30");
    const f = returnFigures(current, null);
    expect(f.investmentIncome).toBe(1_000_001);
    expect(f.t1044.investmentIncomeOver).toBe(true);
    expect(f.t1044.priorAssetsOver).toBeNull();
    expect(f.t1044.indication).toBe("likely");

    const quiet = returnFigures(buildStatements(YEAR, "2025-10-01", "2026-09-30"), buildStatements(YEAR, "2024-10-01", "2025-09-30"));
    expect(quiet.priorYearAssets).toBe(105000);
    expect(quiet.t1044.priorAssetsOver).toBe(false);
    expect(quiet.t1044.indication).toBe("check");
  });
});
