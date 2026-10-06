import { describe, expect, it } from "vitest";
import {
  buildFundChanges,
  fundChangesCsv,
  normalizeFundChangeRow,
  rowAddsUp,
  type FundChangeRow,
} from "@/features/ledger/fund-changes";

function fund(partial: Partial<FundChangeRow> & Pick<FundChangeRow, "code">): FundChangeRow {
  return {
    fund_id: `fund-${partial.code}`,
    name: `Fund ${partial.code}`,
    restriction: "unrestricted",
    is_active: true,
    opening_cents: 0,
    revenue_cents: 0,
    expenses_cents: 0,
    transfers_cents: 0,
    closing_cents: 0,
    ...partial,
  };
}

const general = fund({
  code: "GEN",
  opening_cents: 10_000,
  revenue_cents: 100_000,
  expenses_cents: 30_000,
  transfers_cents: 12_000,
  closing_cents: 92_000,
});
const grant = fund({
  code: "GRANT",
  restriction: "externally_restricted",
  revenue_cents: 50_000,
  expenses_cents: 20_000,
  transfers_cents: -12_000,
  closing_cents: 18_000,
});

describe("statement of changes in fund balances", () => {
  it("totals every column across funds and keeps each fund in code order", () => {
    const s = buildFundChanges([grant, general], "2026-10-01", "2027-09-30");
    expect(s.funds.map((f) => f.code)).toEqual(["GEN", "GRANT"]);
    expect(s.totals).toEqual({
      opening_cents: 10_000,
      revenue_cents: 150_000,
      expenses_cents: 50_000,
      transfers_cents: 0,
      closing_cents: 110_000,
    });
    expect(s.empty).toBe(false);
    expect(rowAddsUp(s.totals)).toBe(true);
    expect(s.funds.every(rowAddsUp)).toBe(true);
  });

  it("drops inactive funds with nothing in them and reports an empty year", () => {
    const retired = fund({ code: "OLD", is_active: false });
    const unused = fund({ code: "NEW" });
    const s = buildFundChanges([retired, unused], "2026-10-01", "2027-09-30");
    expect(s.funds.map((f) => f.code)).toEqual(["NEW"]);
    expect(s.empty).toBe(true);
  });

  it("notices a row that does not add up", () => {
    expect(rowAddsUp({ ...general, closing_cents: general.closing_cents + 1 })).toBe(false);
  });

  it("reads bigint strings from the database as numbers", () => {
    const raw = { ...general, closing_cents: "92000" } as unknown as FundChangeRow;
    expect(normalizeFundChangeRow(raw).closing_cents).toBe(92_000);
  });

  it("exports one row per fund and a total row", () => {
    const csv = fundChangesCsv(buildFundChanges([general, grant], "2026-10-01", "2027-09-30"));
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      'Statement of changes in fund balances 2026-10-01 to 2027-09-30,"Prepared for your accountant, not filed"',
    );
    expect(lines[1]).toBe(
      "Fund,Name,Restriction,Balance 2026-10-01,Revenue,Expenses,Transfers and releases,Balance 2027-09-30",
    );
    expect(lines[2]).toBe("GEN,Fund GEN,Unrestricted,100.00,1000.00,300.00,120.00,920.00");
    expect(lines[3]).toBe("GRANT,Fund GRANT,Externally restricted,0.00,500.00,200.00,'-120.00,180.00");
    expect(lines[4]).toBe(",All funds,,100.00,1500.00,500.00,0.00,1100.00");
  });
});
