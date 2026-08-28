import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  versionToShow,
  type ReportVersionRow,
} from "@/features/reports/services/report.queries";

function migration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`missing migration ending ${suffix}`);
  return readFileSync(join(dir, file), "utf8");
}

function version(
  number: number,
  decision?: "approved" | "rejected",
): ReportVersionRow {
  return {
    id: `v${number}`,
    version_number: number,
    snapshot: { metrics: { tasks_completed: number * 10 } },
    note: null,
    generated_at: `2026-0${number}-01T00:00:00Z`,
    generated_by_name: "Someone",
    approval: decision
      ? {
          id: `a${number}`,
          decision,
          note: null,
          decided_at: `2026-0${number}-02T00:00:00Z`,
          decided_by_name: "An admin",
        }
      : null,
  };
}

describe("which version a reader is shown", () => {
  it("shows the approved version even when a newer one exists", () => {
    // The whole point of versioning: regenerating must not silently change
    // what a funder was sent.
    const versions = [version(3), version(2, "approved"), version(1)];
    expect(versionToShow(versions)?.version_number).toBe(2);
  });

  it("shows the latest when nothing is approved", () => {
    expect(versionToShow([version(3), version(2), version(1)])?.version_number).toBe(3);
  });

  it("does not treat a rejection as an approval", () => {
    const versions = [version(2), version(1, "rejected")];
    expect(versionToShow(versions)?.version_number).toBe(2);
  });

  it("has nothing to show when there are no versions", () => {
    expect(versionToShow([])).toBeNull();
  });
});

describe("what the database guarantees", () => {
  const sql = migration("_report_versions_and_approvals.sql");

  it("makes versions append-only by giving them no update policy", () => {
    // This is the immutability guarantee, and it is an absence rather than a
    // statement — which is exactly the kind of thing a refactor deletes by
    // accident while "tidying up the policies".
    expect(sql).toContain("create policy report_version_read");
    expect(sql).toContain("create policy report_version_insert");
    expect(sql).not.toMatch(/create policy \w+ on report_version for update/);
    expect(sql).not.toMatch(/create policy \w+ on report_version for delete/);
    expect(sql).not.toMatch(/create policy \w+ on report_version for all/);
  });

  it("allows one decision per version", () => {
    expect(sql).toContain(
      "create unique index uq_report_approval_version on report_approval (report_version_id)",
    );
  });

  it("numbers versions uniquely within a report", () => {
    expect(sql).toContain(
      "create unique index uq_report_version on report_version (report_id, version_number)",
    );
  });

  it("clears the sign-off when a new version lands", () => {
    const fn = sql.slice(sql.indexOf("function public.record_report_version"));
    expect(fn).toContain("approved_by = null");
    expect(fn).toContain("status = 'draft'");
  });

  it("carries every existing report forward as version 1", () => {
    expect(sql).toMatch(/insert into report_version[\s\S]*?from report_instance r;/);
  });
});
