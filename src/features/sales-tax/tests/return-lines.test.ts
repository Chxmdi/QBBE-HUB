import { describe, expect, it } from "vitest";
import {
  closingFigures,
  gstReturnLines,
  psbRebate,
  qstReturnLines,
  shareOf,
  taxOnAmount,
  type TaxTotalsRow,
} from "@/features/sales-tax/return-lines";
import { periodEnd, suggestNextPeriod } from "@/features/sales-tax/periods";
import { buildWorksheet, worksheetCsv, type TaxLine } from "@/features/sales-tax/services/sales-tax.queries";

function row(partial: Partial<TaxTotalsRow> & Pick<TaxTotalsRow, "direction" | "tax_code">): TaxTotalsRow {
  return { line_count: 1, amount_cents: 0, gst_cents: 0, qst_cents: 0, itc_cents: 0, itr_cents: 0, ...partial };
}

// The same period the database test builds: $200 standard sale, $200
// zero-rated, $50 exempt; purchases with $12.65 GST and $25.23 QST paid.
const rows: TaxTotalsRow[] = [
  row({ direction: "sale", tax_code: "standard", amount_cents: 20000, gst_cents: 1000, qst_cents: 1995 }),
  row({ direction: "sale", tax_code: "zero_rated", amount_cents: 20000 }),
  row({ direction: "sale", tax_code: "exempt", amount_cents: 5000 }),
  row({ direction: "sale", tax_code: "out_of_scope", amount_cents: 100000 }),
  row({
    direction: "purchase",
    tax_code: "standard",
    line_count: 3,
    amount_cents: 25300,
    gst_cents: 1265,
    qst_cents: 2523,
    itc_cents: 1258,
    itr_cents: 2509,
  }),
];

const byLine = (lines: { line: string; cents: number }[]) => Object.fromEntries(lines.map((l) => [l.line, l.cents]));

describe("rounding", () => {
  it("rounds half a cent up and uses exact decimal rates", () => {
    expect(taxOnAmount(10000, "9.975")).toBe(998);
    expect(taxOnAmount(10, "5")).toBe(1);
    expect(taxOnAmount(9, "5")).toBe(0);
    expect(taxOnAmount(1990, "9.975")).toBe(199);
    expect(taxOnAmount(123456789, "5")).toBe(6172839);
    // A float would drift here: 0.1 + 0.2 style errors never reach a figure.
    expect(taxOnAmount(99999999999, "9.975")).toBe(9975000000) // 9 974 999 999.900 25 cents;
  });

  it("refuses rates it cannot read exactly", () => {
    expect(() => taxOnAmount(100, "9,975")).toThrow();
    expect(() => taxOnAmount(-1, "5")).toThrow();
  });

  it("takes a share in basis points, half a cent up", () => {
    expect(shareOf(15, 5000)).toBe(8);
    expect(shareOf(29, 5000)).toBe(15);
    expect(shareOf(1000, 10000)).toBe(1000);
    expect(shareOf(1000, 0)).toBe(0);
  });
});

describe("return lines", () => {
  it("maps the period to the GST return lines", () => {
    const gst = byLine(gstReturnLines(rows));
    expect(gst["101"]).toBe(40000); // standard + zero-rated; exempt and out of scope left out
    expect(gst["103"]).toBe(1000);
    expect(gst["105"]).toBe(1000);
    expect(gst["106"]).toBe(1258);
    expect(gst["108"]).toBe(1258);
    expect(gst["109"]).toBe(-258); // a refund
  });

  it("maps the period to the QST return lines", () => {
    const qst = byLine(qstReturnLines(rows));
    expect(qst["203"]).toBe(1995);
    expect(qst["205"]).toBe(1995);
    expect(qst["206"]).toBe(2509);
    expect(qst["208"]).toBe(2509);
    expect(qst["209"]).toBe(-514);
  });

  it("closing figures are the collected and claimed totals the database posts", () => {
    expect(closingFigures(rows)).toEqual({ gstCollected: 1000, gstClaimed: 1258, qstCollected: 1995, qstClaimed: 2509 });
  });

  it("an empty period is all zeros", () => {
    expect(gstReturnLines([]).every((l) => l.cents === 0)).toBe(true);
    expect(qstReturnLines([]).every((l) => l.cents === 0)).toBe(true);
  });
});

describe("public service body rebate", () => {
  it("is half of the tax paid and not claimed back", () => {
    const rebate = psbRebate(rows);
    expect(rebate.gstPaidNotClaimed).toBe(7);
    expect(rebate.gstRebate).toBe(4); // 3.5 cents rounds up
    expect(rebate.qstPaidNotClaimed).toBe(14);
    expect(rebate.qstRebate).toBe(7);
  });
});

describe("periods", () => {
  it("ends each period on the last day of its last month", () => {
    expect(periodEnd("2026-10-01", "quarterly")).toBe("2026-12-31");
    expect(periodEnd("2026-10-01", "annual")).toBe("2027-09-30");
    expect(periodEnd("2027-02-01", "monthly")).toBe("2027-02-28");
    expect(periodEnd("2028-02-01", "monthly")).toBe("2028-02-29");
  });

  it("suggests the period after the latest, or the switchover", () => {
    expect(suggestNextPeriod(null, "quarterly")).toEqual({ startsOn: "2026-10-01", endsOn: "2026-12-31" });
    expect(suggestNextPeriod("2026-12-31", "quarterly")).toEqual({ startsOn: "2027-01-01", endsOn: "2027-03-31" });
  });
});

describe("worksheet CSV", () => {
  it("lists the return lines and every source line, neutralising formulas", () => {
    const line: TaxLine = {
      id: "1",
      direction: "sale",
      tax_code: "standard",
      transaction_date: "2026-10-10",
      counterparty: "=HYPERLINK(1)",
      reference: "INV-1",
      description: "Fees, October",
      amount_cents: 20000,
      gst_cents: 1000,
      qst_cents: 1995,
      itc_cents: 0,
      itr_cents: 0,
      source_type: null,
      source_id: null,
    };
    const csv = worksheetCsv("2026-10-01", "2026-12-31", buildWorksheet(rows), [line], true);
    expect(csv).toContain("GST,109,");
    expect(csv).toContain("-2.58");
    expect(csv).toContain("QST,209,");
    expect(csv).toContain("confirm eligibility with your accountant");
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"Fees, October"');
    expect(csv).toContain("200.00,10.00,19.95");
    const withoutRebate = worksheetCsv("2026-10-01", "2026-12-31", buildWorksheet(rows), [], false);
    expect(withoutRebate).not.toContain("rebate");
  });
});
