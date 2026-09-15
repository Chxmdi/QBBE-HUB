import { expect, it } from "vitest";
import { buildReportSnapshot } from "../services/report.snapshot";

type Row = Record<string, unknown>;
function fixture(tables: Record<string, Row[]>, failTable?: string) {
  return { from(table: string) {
    let rows = tables[table] ?? [];
    const value = (row: Row, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v as Row | undefined)?.[k], row);
    const query = {
      select() { return query; },
      eq(key: string, expected: unknown) { rows = rows.filter(r => value(r, key) === expected); return query; },
      is(key: string, expected: unknown) { return query.eq(key, expected); },
      gte(key: string, expected: string) { rows = rows.filter(r => String(value(r, key)) >= expected); return query; },
      lt(key: string, expected: string) { rows = rows.filter(r => String(value(r, key)) < expected); return query; },
      order() { return query; },
      async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
      async range(start: number, end: number) {
        return table === failTable ? { data: null, error: { message: "Unavailable" } }
          : { data: rows.slice(start, Math.min(start + 100, end + 1)), error: null };
      },
    };
    return query;
  } } as unknown as Parameters<typeof buildReportSnapshot>[0];
}

const request = { reportType: "program_quarterly" as const, programId: "ours", periodStart: "2026-01-01", periodEnd: "2026-03-31" };
it("keeps program decisions scoped and counts all pages", async () => {
  const result = await buildReportSnapshot(fixture({
    program: [{ id: "ours", name: "Our program" }],
    task: Array.from({ length: 1203 }, (_, id) => ({ id, program_id: "ours", archived_at: null, completed_at: "2026-02-01" })),
    decision: [
      { id: "yes", decided_at: "2026-02-01", project: { program_id: "ours" } },
      { id: "no", decided_at: "2026-02-01", project: { program_id: "other" } },
    ],
  }), request);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect((result.snapshot.metrics as Row).tasks_total).toBe(1203);
  expect((result.snapshot.decisions as Row[]).map(r => r.id)).toEqual(["yes"]);
});
it("refuses an incomplete snapshot when a query fails", async () => {
  const result = await buildReportSnapshot(fixture({ program: [{ id: "ours", name: "Our program" }] }, "task"), request);
  expect(result.ok).toBe(false);
});
