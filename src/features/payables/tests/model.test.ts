import { describe, expect, it } from "vitest";
import {
  addDays,
  agingCsv,
  invoiceLabel,
  summarizeAging,
  type AgingRow,
} from "@/features/payables/model";

function row(contact: string, bucket: AgingRow["bucket"], open: number): AgingRow {
  return {
    document_id: `${contact}-${bucket}-${open}`,
    contact_id: contact,
    contact_name: contact === "a" ? "Zeta Papeterie" : "=Alpha Inc",
    reference: "F-1",
    document_date: "2026-10-01",
    due_date: "2026-10-31",
    control_account_id: "ap",
    total_cents: open,
    open_cents: open,
    days_past_due: 0,
    bucket,
  };
}

describe("summarizeAging", () => {
  it("totals each bucket, overall and per contact, contacts by name", () => {
    const { totals, contacts } = summarizeAging([
      row("a", "current", 1000),
      row("a", "90+", 250),
      row("b", "31-60", 499),
    ]);
    expect(totals).toEqual({ current: 1000, "1-30": 0, "31-60": 499, "61-90": 0, "90+": 250, total: 1749 });
    expect(contacts.map((c) => c.name)).toEqual(["=Alpha Inc", "Zeta Papeterie"]);
    expect(contacts[1].totals.total).toBe(1250);
  });

  it("is zero for nothing open", () => {
    expect(summarizeAging([]).totals.total).toBe(0);
  });
});

describe("agingCsv", () => {
  it("writes decimals, bucket totals and neutralises formula text", () => {
    const csv = agingCsv("bill", "2026-12-31", [row("b", "31-60", 499)]);
    expect(csv.startsWith("﻿Accounts payable aging")).toBe(true);
    expect(csv).toContain("'=Alpha Inc,F-1,2026-10-01,2026-10-31,0,31–60 days,4.99,4.99");
    expect(csv).toContain(",Total,,4.99\r\n");
  });
});

describe("helpers", () => {
  it("adds days across month ends", () => {
    expect(addDays("2026-10-15", 30)).toBe("2026-11-14");
    expect(addDays("2027-02-27", 2)).toBe("2027-03-01");
  });

  it("labels invoices", () => {
    expect(invoiceLabel(42)).toBe("INV-0042");
    expect(invoiceLabel(null)).toBe("Draft");
  });
});
