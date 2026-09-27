import { describe, expect, it } from "vitest";
import { reconciliationCsv } from "@/features/banking/report";

describe("reconciliation report CSV", () => {
  it("shows the balances, the difference, every line and neutralises formulas", () => {
    const csv = reconciliationCsv({
      organizationName: "Example Org",
      accountLabel: "Chequing ending 1234",
      ledgerAccountLabel: "1000 Bank - chequing",
      statementStart: "2026-10-01",
      statementEnd: "2026-10-31",
      status: "reconciled",
      reconciledAt: "2026-11-05T12:00:00Z",
      openingCents: 1000000,
      closingCents: 993805,
      figures: {
        statement_lines_cents: -6195,
        statement_gap_cents: 0,
        ledger_balance_cents: 988805,
        cleared_balance_cents: 993805,
        outstanding_cents: -5000,
        unmatched_count: 0,
        difference_cents: 0,
      },
      lines: [
        {
          posted_on: "2026-10-05",
          description: "=HYPERLINK(\"x\")",
          reference: null,
          amount_cents: -795,
          entry_number: 7,
          entry_date: "2026-10-05",
          match_method: "created",
        },
      ],
      outstanding: [{ entry_date: "2026-10-30", entry_number: 9, memo: "Cheque 102", amount_cents: -5000 }],
    });
    expect(csv.startsWith("﻿Bank reconciliation,Example Org\r\n")).toBe(true);
    expect(csv).toContain("Statement closing balance,9938.05");
    expect(csv).toContain("Difference (closing balance less cleared ledger balance),0.00");
    expect(csv).toContain("Less: outstanding ledger items,-50.00");
    expect(csv).toContain(`2026-10-05,"'=HYPERLINK(""x"")",,-7.95,7,2026-10-05,created`);
    expect(csv).toContain("2026-10-30,9,Cheque 102,-50.00");
  });
});
