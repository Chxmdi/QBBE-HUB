import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPEN_REQUEST_STATUSES,
  PROJECT_REQUEST_STATUSES,
  REFUSED_REQUEST_STATUSES,
  STALE_AFTER_DAYS,
  createProjectRequestSchema,
  daysWaiting,
  decideApprovalSchema,
  decideProjectRequestSchema,
  isOpenRequest,
  requestApprovalSchema,
  requestIsStale,
} from "@/features/requests/schemas";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function migration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`missing migration ending ${suffix}`);
  return readFileSync(join(dir, file), "utf8");
}

describe("request statuses", () => {
  it("splits into open and settled with nothing left over", () => {
    const settled = PROJECT_REQUEST_STATUSES.filter((s) => !isOpenRequest(s));
    expect([...OPEN_REQUEST_STATUSES].sort()).toEqual(
      PROJECT_REQUEST_STATUSES.filter(isOpenRequest).sort(),
    );
    expect(settled).toContain("approved");
    expect(REFUSED_REQUEST_STATUSES.every((s) => settled.includes(s))).toBe(true);
  });

  it("uses the same statuses the enum declares", () => {
    const sql = migration("_intake_requests.sql");
    for (const status of PROJECT_REQUEST_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  it("agrees with the database about which statuses owe an explanation", () => {
    // `refused_requests_explain_themselves` names exactly these.
    const sql = migration("_intake_requests.sql");
    const constraint = sql.slice(
      sql.indexOf("refused_requests_explain_themselves"),
      sql.indexOf("decided_requests_are_attributable"),
    );
    for (const status of REFUSED_REQUEST_STATUSES) {
      expect(constraint).toContain(`'${status}'`);
    }
    expect(constraint).not.toContain("'approved'");
  });
});

describe("proposing", () => {
  it("insists on more than a title", () => {
    const result = createProjectRequestSchema.safeParse({ title: "Coding club" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/not a request/);
    }
  });

  it("says something useful when a field is missing, not just 'Required'", () => {
    // The form dialog omits empty values, so a blank field arrives missing.
    // Without required_error, Zod answers "Required" and the sentence written
    // for the person is never shown — which is how this was found.
    for (const input of [{}, { title: "Coding club" }, { summary: "Weekly club" }]) {
      const result = createProjectRequestSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).not.toBe("Required");
      }
    }
  });

  it("accepts a proposal with a summary", () => {
    expect(
      createProjectRequestSchema.safeParse({
        title: "Coding club",
        summary: "A weekly club for 11-16s",
      }).success,
    ).toBe(true);
  });
});

describe("deciding a request", () => {
  it("refuses a decline with no reason", () => {
    const result = decideProjectRequestSchema.safeParse({
      requestId: ID,
      status: "declined",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/needs to know/);
    }
  });

  it("refuses a withdrawal with no reason", () => {
    expect(
      decideProjectRequestSchema.safeParse({ requestId: ID, status: "withdrawn" })
        .success,
    ).toBe(false);
  });

  it("does not demand a reason to approve", () => {
    expect(
      decideProjectRequestSchema.safeParse({ requestId: ID, status: "approved" })
        .success,
    ).toBe(true);
  });
});

describe("approval requests", () => {
  it("insists on exactly one subject", () => {
    const none = requestApprovalSchema.safeParse({ approverId: ID });
    expect(none.success).toBe(false);

    const two = requestApprovalSchema.safeParse({
      approverId: ID,
      projectRequestId: ID,
      reportId: OTHER,
    });
    expect(two.success).toBe(false);
    if (!two.success) {
      expect(two.error.issues[0].message).toMatch(/exactly one record/);
    }

    const one = requestApprovalSchema.safeParse({
      approverId: ID,
      reportId: OTHER,
    });
    expect(one.success).toBe(true);
  });

  it("mirrors the database's exactly-one rule", () => {
    const sql = migration("_intake_requests.sql");
    expect(sql).toContain(
      "num_nonnulls(project_request_id, report_id, opportunity_id) = 1",
    );
  });

  it("refuses a rejection with no reason", () => {
    expect(
      decideApprovalSchema.safeParse({ approvalId: ID, decision: "rejected" }).success,
    ).toBe(false);
    expect(
      decideApprovalSchema.safeParse({
        approvalId: ID,
        decision: "rejected",
        decisionNote: "Out of scope for this year.",
      }).success,
    ).toBe(true);
  });

  it("does not demand a reason to approve", () => {
    expect(
      decideApprovalSchema.safeParse({ approvalId: ID, decision: "approved" }).success,
    ).toBe(true);
  });
});

describe("how long something has waited", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("counts whole days and never goes negative", () => {
    expect(daysWaiting("2026-03-15T11:00:00Z", now)).toBe(0);
    expect(daysWaiting("2026-03-14T11:00:00Z", now)).toBe(1);
    // A clock skew that puts submission in the future must read as 0, not -1.
    expect(daysWaiting("2026-04-01T00:00:00Z", now)).toBe(0);
  });

  it("calls an unanswered request stale, and a decided one never", () => {
    const old = new Date(now.getTime() - (STALE_AFTER_DAYS + 1) * 86_400_000)
      .toISOString();
    expect(requestIsStale({ status: "submitted", created_at: old }, now)).toBe(true);
    expect(requestIsStale({ status: "in_review", created_at: old }, now)).toBe(true);
    expect(requestIsStale({ status: "approved", created_at: old }, now)).toBe(false);
    expect(requestIsStale({ status: "declined", created_at: old }, now)).toBe(false);
    expect(
      requestIsStale({ status: "submitted", created_at: now.toISOString() }, now),
    ).toBe(false);
  });
});
