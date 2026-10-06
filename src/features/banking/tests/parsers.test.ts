import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "@/features/banking/fingerprint";
import {
  parseCsvStatement,
  parseOfxStatement,
  parseSignedCents,
  parseStatementDate,
  parseStatementFile,
  readCsv,
  type ParseResult,
} from "@/features/banking/parsers";
import { pickSuggestions } from "@/features/banking/matching";

// Every sample file is fabricated: no real institution, account or person.
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

function lines(result: ParseResult) {
  if (!result.ok) throw new Error(result.error);
  return result.statement.lines.map(({ postedOn, amountCents, description, reference }) => ({
    postedOn,
    amountCents,
    description,
    reference,
  }));
}

describe("values", () => {
  it("reads signed amounts in the forms banks export", () => {
    expect(parseSignedCents("-12.34")).toBe(-1234);
    expect(parseSignedCents("12,34-")).toBe(-1234);
    expect(parseSignedCents("(1 234,56 $)")).toBe(-123456);
    expect(parseSignedCents("+5")).toBe(500);
    expect(parseSignedCents("1 000,00")).toBe(100000);
    expect(parseSignedCents("CAD 3.50")).toBe(350);
  });

  it("refuses amounts that would need a guess", () => {
    expect(parseSignedCents("1,234")).toBeNull();
    expect(parseSignedCents("4.567")).toBeNull();
    expect(parseSignedCents("abc")).toBeNull();
    expect(parseSignedCents("")).toBeNull();
    expect(parseSignedCents("--5")).toBeNull();
  });

  it("reads dates in each order and refuses impossible ones", () => {
    expect(parseStatementDate("2026/10/05", "ymd")).toBe("2026-10-05");
    expect(parseStatementDate("20261005120000[-5:EST]", "ymd")).toBe("2026-10-05");
    expect(parseStatementDate("10/5/2026", "mdy")).toBe("2026-10-05");
    expect(parseStatementDate("05/10/2026", "dmy")).toBe("2026-10-05");
    expect(parseStatementDate("2026-02-30", "ymd")).toBeNull();
    expect(parseStatementDate("13/01/2026", "mdy")).toBeNull();
    expect(parseStatementDate("26/10/05", "ymd")).toBeNull();
  });

  it("splits quoted CSV with either delimiter and a byte-order mark", () => {
    expect(readCsv('﻿a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    expect(readCsv("a;b;c\n1;2,5;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2,5", "3"],
    ]);
  });
});

describe("bank CSV layouts", () => {
  it("Desjardins: no header, French decimals, withdrawal and deposit columns", () => {
    const result = parseCsvStatement(fixture("desjardins.csv"), "desjardins");
    expect(lines(result)).toEqual([
      { postedOn: "2026-10-01", amountCents: 25000, description: "Depot - dons en ligne", reference: null },
      { postedOn: "2026-10-03", amountCents: -795, description: "Frais de service", reference: null },
      { postedOn: "2026-10-05", amountCents: -100000, description: "Cheque", reference: "101" },
      { postedOn: "2026-10-05", amountCents: -500, description: "Cafe", reference: null },
      { postedOn: "2026-10-05", amountCents: -500, description: "Cafe", reference: null },
    ]);
  });

  it("National Bank: semicolons and a French header", () => {
    expect(lines(parseCsvStatement(fixture("national_bank.csv"), "national_bank"))).toEqual([
      { postedOn: "2026-10-02", amountCents: 500000, description: "DEPOT SUBVENTION", reference: null },
      { postedOn: "2026-10-04", amountCents: -120000, description: "PAIEMENT LOYER", reference: null },
    ]);
  });

  it("RBC: signed CAD$ column, two description columns, cheque number", () => {
    expect(lines(parseCsvStatement(fixture("rbc.csv"), "rbc"))).toEqual([
      { postedOn: "2026-10-02", amountCents: 15000, description: "DEPOSIT MEMBERSHIP FEES", reference: null },
      { postedOn: "2026-10-09", amountCents: -30000, description: "CHEQUE", reference: "102" },
      { postedOn: "2026-10-31", amountCents: -400, description: "MONTHLY FEE", reference: null },
    ]);
  });

  it("TD: no header, month-first dates, quoted commas", () => {
    expect(lines(parseCsvStatement(fixture("td.csv"), "td"))).toEqual([
      { postedOn: "2026-10-01", amountCents: 50000, description: "OPENING DEPOSIT", reference: null },
      { postedOn: "2026-10-15", amountCents: -4218, description: "STAPLES, INC", reference: null },
      { postedOn: "2026-10-20", amountCents: 12, description: "INTEREST", reference: null },
    ]);
  });

  it("BMO: preamble before the header, compact dates", () => {
    expect(lines(parseCsvStatement(fixture("bmo.csv"), "bmo"))).toEqual([
      { postedOn: "2026-10-06", amountCents: -2550, description: "[PR]HYDRO-QUEBEC", reference: null },
      { postedOn: "2026-10-12", amountCents: 100000, description: "[DN]GRANT PAYMENT", reference: null },
    ]);
  });

  it("refuses a file that does not fit the chosen bank", () => {
    const result = parseCsvStatement(fixture("td.csv"), "rbc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not look like a RBC Royal Bank file/);
  });

  it("refuses the whole file when one amount is ambiguous", () => {
    const text = "10/01/2026,OK,,5.00,5.00\n10/02/2026,BAD,\"1,234\",,0\n";
    const result = parseCsvStatement(text, "td");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Row 2/);
  });

  it("applies a custom column mapping", () => {
    const text = "When,What,Amount\n05-10-2026,Donation,\"12,50\"\n06-10-2026,Fee,-1.00\n";
    const result = parseCsvStatement(text, "custom", {
      dateColumn: 0,
      dateOrder: "dmy",
      descriptionColumns: [1],
      amount: { kind: "signed", column: 2 },
      skipRows: 1,
    });
    expect(lines(result)).toEqual([
      { postedOn: "2026-10-05", amountCents: 1250, description: "Donation", reference: null },
      { postedOn: "2026-10-06", amountCents: -100, description: "Fee", reference: null },
    ]);
  });
});

describe("OFX and QFX", () => {
  it("reads version 1 (SGML) with the bank's ids, balance and last four digits", () => {
    const result = parseOfxStatement(fixture("sample.ofx"));
    expect(lines(result)).toEqual([
      { postedOn: "2026-10-03", amountCents: 25000, description: "DONATION & GIFT ONLINE", reference: "FIT0001" },
      { postedOn: "2026-10-10", amountCents: -8999, description: "INTERNET PROVIDER", reference: "FIT0002" },
      { postedOn: "2026-10-15", amountCents: -40000, description: "CHEQUE", reference: "103" },
    ]);
    if (!result.ok) throw new Error();
    expect(result.statement.ledgerBalance).toEqual({ cents: 76001, asOf: "2026-10-31" });
    expect(result.statement.accountLast4).toBe("1234");
    expect(result.statement.lines[0].key).toBe("ofx|FIT0001");
  });

  it("reads version 2 (XML) and is chosen by content or extension", () => {
    const result = parseStatementFile("export.qfx", fixture("sample-v2.qfx"), "td");
    expect(lines(result)).toEqual([
      { postedOn: "2026-11-02", amountCents: -1234, description: "OFFICE SUPPLIES", reference: "X-1" },
      { postedOn: "2026-11-04", amountCents: 10000, description: "MEMBER FEE", reference: "X-2" },
    ]);
    if (!result.ok) throw new Error();
    expect(result.statement.format).toBe("ofx");
    expect(result.statement.accountLast4).toBe("5678");
  });

  it("refuses text that is not OFX", () => {
    expect(parseOfxStatement("hello").ok).toBe(false);
  });
});

describe("fingerprints for de-duplication", () => {
  it("are stable across two downloads of the same statement", () => {
    const keys = (r: ParseResult) => (r.ok ? r.statement.lines.map((l) => fingerprint(l.key)) : []);
    const first = keys(parseCsvStatement(fixture("desjardins.csv"), "desjardins"));
    const second = keys(parseCsvStatement(fixture("desjardins.csv"), "desjardins"));
    expect(second).toEqual(first);
    expect(first.every((f) => /^[0-9a-f]{64}$/.test(f))).toBe(true);
  });

  it("keep two identical lines on one day apart", () => {
    const result = parseCsvStatement(fixture("desjardins.csv"), "desjardins");
    if (!result.ok) throw new Error(result.error);
    const cafe = result.statement.lines.filter((l) => l.description === "Cafe").map((l) => fingerprint(l.key));
    expect(cafe).toHaveLength(2);
    expect(new Set(cafe).size).toBe(2);
  });

  it("match the overlapping part of a later, longer download", () => {
    const short = parseCsvStatement("10/01/2026,A,,5.00,5\n", "td");
    const long = parseCsvStatement("10/01/2026,A,,5.00,5\n10/02/2026,B,1.00,,4\n", "td");
    if (!short.ok || !long.ok) throw new Error();
    expect(long.statement.lines[0].key).toBe(short.statement.lines[0].key);
  });
});

describe("suggested matches", () => {
  it("gives each statement line the closest unused ledger line", () => {
    const picked = pickSuggestions([
      { bank_transaction_id: "t1", journal_line_id: "l1", day_gap: 2 },
      { bank_transaction_id: "t1", journal_line_id: "l2", day_gap: 0 },
      { bank_transaction_id: "t2", journal_line_id: "l2", day_gap: 1 },
      { bank_transaction_id: "t2", journal_line_id: "l3", day_gap: 5 },
    ]);
    expect(picked.get("t1")?.journal_line_id).toBe("l2");
    expect(picked.get("t2")?.journal_line_id).toBe("l3");
  });
});
