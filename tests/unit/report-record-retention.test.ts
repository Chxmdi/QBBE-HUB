import { describe, expect, it, vi } from "vitest";
import { reportRecordRetention } from "@/features/jobs/services/handlers/report-record-retention";
import {
  fiscalYearEndSchema,
  placeHoldSchema,
  summarizeRegister,
  type RegisterRow,
} from "@/features/record-retention/schemas";
import { FakeSupabase, asClient } from "../support/fake-supabase";

function row(overrides: Partial<RegisterRow>): RegisterRow {
  return {
    record_type: "document",
    record_id: crypto.randomUUID(),
    title: "Receipt",
    category_key: "receipt",
    record_date: "2015-01-01",
    retain_until: "2022-01-01",
    held: false,
    past_retention: true,
    ...overrides,
  };
}

function fixture(register: Record<string, RegisterRow[] | Error>) {
  const db = new FakeSupabase();
  db.seed("organization", Object.keys(register).map((id) => ({ id })));
  const rpc = vi.fn(async (_name: string, args: { p_organization: string }) => {
    const result = register[args.p_organization];
    return result instanceof Error
      ? { data: null, error: { message: result.message } }
      : { data: result, error: null };
  });
  const client = Object.assign(asClient(db), { rpc });
  return {
    db,
    rpc,
    context: {
      db: client,
      now: db.now(),
      definition: {
        name: "report-record-retention", description: "test", enabled: true,
        schedule: "50 2 * * *", queue: null, batch_size: 100, max_attempts: 3,
      },
    },
  };
}

describe("records retention report", () => {
  it("counts only unheld records past retention", () => {
    const summary = summarizeRegister([
      row({}),
      row({ category_key: "bill" }),
      row({ held: true }),
      row({ past_retention: false, retain_until: "2099-01-01" }),
    ]);
    expect(summary).toEqual({ pastRetention: 2, held: 1, byCategory: { receipt: 1, bill: 1 } });
  });

  it("writes one report per organization and deletes nothing", async () => {
    const { db, context, rpc } = fixture({ "org-1": [row({}), row({ held: true })], "org-2": [] });
    const deletes: string[] = [];
    // Observes every call without failing any of them.
    db.fail((op) => {
      if (op.kind === "delete") deletes.push(op.name);
      return false;
    });
    const result = await reportRecordRetention(context);
    expect(result).toMatchObject({ processed: 2, failed: 0, metadata: { past_retention: 1 } });
    expect(rpc).toHaveBeenCalledWith("record_retention_register", { p_organization: "org-1" });
    const reports = db.rows("record_retention_report");
    expect(reports).toHaveLength(2);
    expect(reports.find((r) => r.organization_id === "org-1")).toMatchObject({
      past_retention_count: 1,
      held_count: 1,
    });
    expect(deletes).toEqual([]);
  });

  it("records a failure for one organization without stopping the others", async () => {
    const { db, context } = fixture({ "org-1": new Error("boom"), "org-2": [row({})] });
    const result = await reportRecordRetention(context);
    expect(result).toMatchObject({ processed: 1, failed: 1 });
    expect(db.rows("record_retention_report")).toHaveLength(1);
  });
});

describe("records retention forms", () => {
  it("refuses a fiscal year end that does not exist", () => {
    expect(fiscalYearEndSchema.safeParse({ month: 2, day: 29 }).success).toBe(false);
    expect(fiscalYearEndSchema.safeParse({ month: 4, day: 31 }).success).toBe(false);
    expect(fiscalYearEndSchema.safeParse({ month: "3", day: "31" }).success).toBe(true);
  });

  it("requires a reason to place a hold", () => {
    const missing = placeHoldSchema.safeParse({ scope: "category", categoryKey: "receipt" });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.message).toBe("Say why the hold is needed.");
    expect(
      placeHoldSchema.safeParse({ scope: "category", categoryKey: "receipt", reason: "CRA audit" }).success,
    ).toBe(true);
  });
});
