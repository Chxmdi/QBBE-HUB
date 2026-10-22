import { describe, expect, it } from "vitest";
import { GL_EXPORT_LIMIT, GL_SCREEN_LIMIT, generalLedger } from "@/features/ledger/services/ledger.reports";
import { LINE_LIMIT, TAX_EXPORT_LINE_LIMIT, filteredTotals, listTaxLines } from "@/features/sales-tax/services/sales-tax.queries";
import { AGING_LIMIT, readAging } from "@/features/payables/services/aging.queries";
import { FORM_EXPORT_LIMIT, readSubmissionsForExport } from "@/features/forms/services/submission.export";

/**
 * DATA-003. Finance exports and on-screen reports read through PostgREST,
 * which returns at most 1,000 rows per request and does not say when it has
 * cut a result short. The fake client below behaves the same way: whatever a
 * request asks for (.limit(10000), no limit, a .range() of any size), it
 * returns at most 1,000 rows. Each reader must still return every row, or say
 * plainly that it stopped at its ceiling.
 */

const SERVER_CAP = 1000;

interface Recorded {
  method: string;
  args: unknown[];
}

function cappedClient(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `row-${String(i).padStart(6, "0")}`,
    debit_cents: "100",
    credit_cents: "0",
    opening_cents: "0",
    running_cents: String(100 * (i + 1)),
    amount_cents: "1000",
    gst_cents: "50",
    qst_cents: "100",
    itc_cents: "0",
    itr_cents: "0",
    total_cents: "1000",
    open_cents: "1000",
    answers: {},
    signature: [],
  }));
  const calls: Recorded[] = [];
  type State = { from: number; to: number };
  const builder = (state: State): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === "then") {
            const start = state.from;
            const end = Math.min(state.to + 1, start + SERVER_CAP, rows.length);
            const result = { data: rows.slice(start, Math.max(start, end)), error: null };
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject);
          }
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            if (prop === "range") return builder({ from: args[0] as number, to: args[1] as number });
            if (prop === "limit") return builder({ from: 0, to: (args[0] as number) - 1 });
            return builder(state);
          };
        },
      },
    );
  const client = {
    rpc: (...args: unknown[]) => {
      calls.push({ method: "rpc", args });
      return builder({ from: 0, to: Number.MAX_SAFE_INTEGER });
    },
    from: (...args: unknown[]) => {
      calls.push({ method: "from", args });
      return builder({ from: 0, to: Number.MAX_SAFE_INTEGER });
    },
  };
  // The readers only use rpc/from and the query builder's chain.
  return { client: client as never, calls };
}

const ordersOf = (calls: Recorded[]) =>
  [...new Set(calls.filter((c) => c.method === "order").map((c) => c.args[0] as string))];

describe("general ledger reads past the 1,000-row cap (DATA-003)", () => {
  it("returns all 1,500 posted lines for the CSV", async () => {
    const { client } = cappedClient(1500);
    const { rows, error, truncated } = await generalLedger(client, "org", "2026-01-01", "2026-12-31", null, null, GL_EXPORT_LIMIT);
    expect(error).toBeNull();
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1500);
    expect(rows[1499].running_cents).toBe(150000);
  });

  it("flags the on-screen view as incomplete instead of silently stopping at 1,000", async () => {
    const { client } = cappedClient(1500);
    const { rows, truncated } = await generalLedger(client, "org", "2026-01-01", "2026-12-31", null, null, GL_SCREEN_LIMIT);
    expect(rows).toHaveLength(GL_SCREEN_LIMIT);
    expect(truncated).toBe(true);
  });

  it("refuses rather than cuts short above the export ceiling", async () => {
    expect(GL_EXPORT_LIMIT).toBeGreaterThan(SERVER_CAP);
    const { client } = cappedClient(2500);
    const { truncated } = await generalLedger(client, "org", "2026-01-01", "2026-12-31", null, null, 2000);
    expect(truncated).toBe(true);
  });
});

describe("GST/QST lines read past the 1,000-row cap (DATA-003)", () => {
  it("returns all 1,200 lines for the worksheet", async () => {
    const { client, calls } = cappedClient(1200);
    const { lines, truncated } = await listTaxLines(client, "org", { from: "2026-01-01", to: "2026-12-31" }, TAX_EXPORT_LINE_LIMIT);
    expect(truncated).toBe(false);
    expect(lines).toHaveLength(1200);
    // Paging needs an order with no ties, or a line can repeat or go missing between pages.
    expect(ordersOf(calls)).toEqual(["transaction_date", "created_at", "id"]);
  });

  it("says the on-screen list is incomplete past its limit", async () => {
    const { client } = cappedClient(1200);
    const { lines, truncated } = await listTaxLines(client, "org", { from: "2026-01-01", to: "2026-12-31" });
    expect(lines).toHaveLength(LINE_LIMIT);
    expect(truncated).toBe(true);
  });
});

describe("aging reads past the 1,000-row cap (DATA-003)", () => {
  it("returns every open document, in an order with no ties", async () => {
    const { client, calls } = cappedClient(1100);
    const { rows, truncated, error } = await readAging(client, "org", "bill", "2026-10-31");
    expect(error).toBeNull();
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1100);
    expect(rows[0].total_cents).toBe(1000);
    expect(ordersOf(calls)).toEqual(["contact_name", "due_date", "document_date", "document_id"]);
    expect(AGING_LIMIT).toBeGreaterThan(SERVER_CAP);
  });
});

describe("form submissions export reads past the 1,000-row cap (DATA-003)", () => {
  it("includes the newest submission when there are more than 1,000", async () => {
    const { client, calls } = cappedClient(1100);
    const { rows, truncated } = await readSubmissionsForExport(client, "form-id");
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(1100);
    expect(rows.at(-1)?.id).toBe("row-001099");
    expect(ordersOf(calls)).toEqual(["submitted_at", "id"]);
    expect(FORM_EXPORT_LIMIT).toBeGreaterThan(SERVER_CAP);
  });
});

describe("GST/QST line totals come from SQL, not the capped list (DATA-003)", () => {
  const rows = [
    { direction: "sale", tax_code: "standard", line_count: 900, amount_cents: 9000, gst_cents: 450, qst_cents: 900, itc_cents: 0, itr_cents: 0 },
    { direction: "sale", tax_code: "exempt", line_count: 200, amount_cents: 2000, gst_cents: 0, qst_cents: 0, itc_cents: 0, itr_cents: 0 },
    { direction: "purchase", tax_code: "standard", line_count: 100, amount_cents: 1000, gst_cents: 50, qst_cents: 100, itc_cents: 50, itr_cents: 100 },
  ] as const;

  it("adds every group when nothing is filtered", () => {
    expect(filteredTotals([...rows], {})).toEqual({ lineCount: 1200, amount: 12000, gst: 500, qst: 1000, itc: 50, itr: 100 });
  });

  it("keeps only the chosen direction and tax codes", () => {
    expect(filteredTotals([...rows], { direction: "sale", codes: ["standard"] })).toEqual({
      lineCount: 900,
      amount: 9000,
      gst: 450,
      qst: 900,
      itc: 0,
      itr: 0,
    });
  });
});
