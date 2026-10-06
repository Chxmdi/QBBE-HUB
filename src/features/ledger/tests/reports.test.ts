import { describe, expect, it } from "vitest";
import {
  generalLedgerCsv,
  groupByAccount,
  trialBalanceCsv,
  type GeneralLedgerRow,
  type TrialBalanceRow,
} from "@/features/ledger/services/ledger.reports";

const tb: TrialBalanceRow[] = [
  { account_id: "a", code: "1000", name: "Bank", account_type: "asset", debit_cents: 150000, credit_cents: 20000, balance_cents: 130000 },
  { account_id: "b", code: "3000", name: "=Net assets", account_type: "net_assets", debit_cents: 0, credit_cents: 100000, balance_cents: -100000 },
  { account_id: "c", code: "4000", name: "Grants", account_type: "revenue", debit_cents: 0, credit_cents: 30000, balance_cents: -30000 },
];

function gl(account: string, n: number, debit: number, credit: number, running: number): GeneralLedgerRow {
  return {
    account_id: account,
    account_code: account === "a" ? "1000" : "5200",
    account_name: account === "a" ? "Bank" : "Rent",
    opening_cents: 0,
    line_id: `${account}${n}`,
    entry_id: `e${n}`,
    entry_number: n,
    entry_date: "2026-10-05",
    memo: "Memo, with comma",
    line_description: null,
    fund_code: "GEN",
    debit_cents: debit,
    credit_cents: credit,
    running_cents: running,
  };
}

describe("trial balance CSV", () => {
  it("puts each balance on its side and totals both columns", () => {
    const lines = trialBalanceCsv(tb, "2026-10-31", "All funds").replace("﻿", "").trim().split("\r\n");
    expect(lines[1]).toBe("Account,Name,Type,Debit,Credit");
    expect(lines[2]).toBe("1000,Bank,Asset,1300.00,");
    expect(lines[3]).toBe("3000,'=Net assets,Net assets,,1000.00");
    expect(lines.at(-1)).toBe(",Total,,1300.00,1300.00");
  });
});

describe("general ledger", () => {
  it("groups lines by account in order", () => {
    const groups = groupByAccount([gl("a", 1, 500, 0, 500), gl("a", 2, 0, 200, 300), gl("b", 2, 200, 0, 200)]);
    expect(groups.map((g) => [g.code, g.rows.length])).toEqual([
      ["1000", 2],
      ["5200", 1],
    ]);
  });

  it("exports running balances and quotes text", () => {
    const csv = generalLedgerCsv([gl("a", 1, 500, 0, 500)], "2026-10-01", "2026-10-31", "All funds");
    expect(csv).toContain('1000,Bank,2026-10-05,1,"Memo, with comma",,GEN,5.00,,5.00,0.00');
  });
});
