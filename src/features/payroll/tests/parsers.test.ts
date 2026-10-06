import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  guessHeaderRow,
  guessMapping,
  parsePayrollFile,
  readCsv,
  type PayrollParseResult,
} from "@/features/payroll/parsers";
import { CATEGORY_KEYS, totalsAddUp } from "@/features/payroll/categories";

// Every sample file is fabricated: no real organization, person or SIN.
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

function runs(result: PayrollParseResult) {
  if (!result.ok) throw new Error(result.error);
  return result.payroll.runs;
}

// The first run in every sample: two people paid 2026-10-16.
const RUN_ONE = {
  gross_wages: 350000,
  ee_federal_tax: 30000,
  ee_quebec_tax: 37000,
  ee_qpp: 21000,
  ee_ei: 4620,
  ee_qpip: 1729,
  ee_other: 1000,
  er_qpp: 21000,
  er_ei: 6468,
  er_qpip: 2422,
  er_fss: 5775,
  er_cnesst: 4375,
  er_cnt: 210,
  er_other: 0,
  net_pay: 254651,
};

describe("presets", () => {
  it("reads a Nethris journal into run totals and checks its total row", () => {
    const result = parsePayrollFile(fixture("nethris.csv"), "nethris");
    const [first, second] = runs(result);
    expect(first).toMatchObject({
      payDate: "2026-10-16",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-14",
      runReference: "101",
      rowsRead: 2,
    });
    expect(first.cents).toEqual(RUN_ONE);
    expect(second).toMatchObject({ payDate: "2026-10-30", runReference: "102", rowsRead: 1 });
    expect(second.cents.net_pay).toBe(143372);
    if (!result.ok) return;
    expect(result.payroll.totalRowsChecked).toBe(1);
    expect(result.payroll.missing).toEqual(["er_other"]);
  });

  it("keeps nothing about employees: no names, no SINs, no per-person lines", () => {
    const result = parsePayrollFile(fixture("nethris.csv"), "nethris");
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/Fictive|000 000 00|Personne/);
    for (const run of runs(result)) {
      expect(Object.keys(run).sort()).toEqual(["cents", "payDate", "periodEnd", "periodStart", "rowsRead", "runReference"]);
      expect(Object.keys(run.cents).sort()).toEqual([...CATEGORY_KEYS].sort());
    }
  });

  it("refuses a file whose total row does not match its lines", () => {
    const tampered = fixture("nethris.csv").replace("Total;2026-10-16;2026-10-01;2026-10-14;;;3 500,00", "Total;2026-10-16;2026-10-01;2026-10-14;;;3 500,01");
    const result = parsePayrollFile(tampered, "nethris");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/total row for Gross wages .* does not equal the sum of its lines/);
  });

  it("reads an ADP Workforce Now register with month-first dates and grouped amounts", () => {
    const [run] = runs(parsePayrollFile(fixture("adp-wfn.csv"), "adp_wfn"));
    expect(run).toMatchObject({ payDate: "2026-10-16", periodStart: "2026-10-01", runReference: "2026-21", rowsRead: 2 });
    expect(run.cents).toEqual(RUN_ONE);
  });

  it("reads a Ceridian Powerpay register that holds only run totals", () => {
    const result = parsePayrollFile(fixture("ceridian-powerpay.csv"), "ceridian_powerpay");
    const list = runs(result);
    expect(list).toHaveLength(2);
    expect(list[0].cents).toEqual(RUN_ONE);
    expect(list[0].rowsRead).toBe(1);
  });

  it("reads an Employeur D journal with day-first dates", () => {
    const [run] = runs(parsePayrollFile(fixture("employeur-d.csv"), "employeur_d"));
    expect(run).toMatchObject({ payDate: "2026-10-16", periodStart: "2026-10-01", periodEnd: "2026-10-14" });
    expect(run.cents.gross_wages).toBe(200000);
    expect(run.cents.net_pay).toBe(144372);
    expect(totalsAddUp(run.cents)).toBe(true);
  });

  it("refuses a file that is not the chosen provider's layout", () => {
    const result = parsePayrollFile(fixture("generic.csv"), "adp_wfn");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/does not look like a ADP Workforce Now export/);
  });
});

describe("refusals", () => {
  it("refuses an amount that could be read two ways", () => {
    const text = fixture("ceridian-powerpay.csv").replace("3500.00", '"3,500"');
    const result = parsePayrollFile(text, "ceridian_powerpay");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/Row 2, Gross Earnings: "3,500" could not be read as an amount without guessing/);
  });

  it("refuses a run that does not add up", () => {
    const text = fixture("ceridian-powerpay.csv").replace("2546.51", "2546.50");
    const result = parsePayrollFile(text, "ceridian_powerpay");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/does not add up/);
  });

  it("refuses an unreadable pay date on an employee line", () => {
    const text = fixture("adp-wfn.csv").replace("10/16/2026,10/01/2026", "next friday,10/01/2026");
    const result = parsePayrollFile(text, "adp_wfn");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/Row 2: pay date "next friday" is not a date/);
  });

  it("refuses two columns with the same header rather than picking one", () => {
    const text = fixture("ceridian-powerpay.csv").replace("Employer QPP", "QPP Employee");
    const result = parsePayrollFile(text, "ceridian_powerpay");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/Two columns are headed "QPP Employee"/);
  });

  it("refuses a negative run total", () => {
    const text = fixture("ceridian-powerpay.csv").replace(",2.10,", ",-2.10,");
    const result = parsePayrollFile(text, "ceridian_powerpay");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/negative total for CNT/);
  });
});

describe("Other CSV", () => {
  it("reads any layout with a column chosen for each figure", () => {
    const rows = readCsv(fixture("generic.csv"));
    const result = parsePayrollFile(fixture("generic.csv"), "other", {
      headerRow: guessHeaderRow(rows),
      dateOrder: "ymd",
      columns: {
        payDate: [0],
        periodStart: [1],
        periodEnd: [2],
        gross_wages: [4],
        ee_federal_tax: [5],
        ee_quebec_tax: [6],
        ee_qpp: [7],
        ee_ei: [8],
        ee_qpip: [9],
        net_pay: [10],
        er_qpp: [11],
        er_ei: [12],
        er_qpip: [13],
        er_fss: [14],
      },
    });
    const [run] = runs(result);
    expect(run.cents).toMatchObject({ gross_wages: 200000, net_pay: 144372, er_fss: 3300 });
    if (result.ok) expect(result.payroll.missing).toEqual(["ee_other", "er_cnesst", "er_cnt", "er_other"]);
  });

  it("asks for the required columns", () => {
    const result = parsePayrollFile(fixture("generic.csv"), "other", { headerRow: 0, dateOrder: "ymd", columns: { payDate: [0] } });
    expect(result).toEqual({ ok: false, error: "Choose the column for Period start." });
  });

  it("guesses a mapping from familiar headers for the person to check", () => {
    const header = readCsv(fixture("adp-wfn.csv"))[0];
    const guess = guessMapping(header);
    expect(guess.payDate).toEqual([1]);
    expect(guess.gross_wages).toEqual([6]);
    expect(guess.net_pay).toEqual([19]);
    expect(guess.er_fss).toEqual([16]);
  });
});
