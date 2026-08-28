import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPORT_KINDS,
  EXPORT_KIND_DESCRIPTIONS,
  EXPORT_KIND_LABELS,
  EXPORT_STATUSES,
  STAFF_EXPORT_KINDS,
  hoursUntilExpiry,
  isDownloadable,
  requestExportSchema,
} from "@/features/exports/schemas";
import { EXPORT_KINDS as BUILDER_KINDS } from "@/features/exports/services/export-builders";
import { JOB_HANDLERS } from "@/features/jobs/services/handlers";

const PERSON = "11111111-1111-4111-8111-111111111111";

function migration(suffix: string): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((name) => name.endsWith(suffix));
  if (!file) throw new Error(`missing migration ending ${suffix}`);
  return readFileSync(join(dir, file), "utf8");
}

describe("kinds line up across three places", () => {
  const sql = migration("_export_jobs.sql");

  it("has a builder for every kind the enum allows", () => {
    // A kind with no builder is a queued export that fails forever; a builder
    // with no kind is dead code. Neither shows up until somebody tries it.
    expect([...BUILDER_KINDS].sort()).toEqual([...EXPORT_KINDS].sort());
  });

  it("declares the same kinds and statuses the database does", () => {
    for (const kind of EXPORT_KINDS) expect(sql).toContain(`'${kind}'`);
    for (const status of EXPORT_STATUSES) expect(sql).toContain(`'${status}'`);
  });

  it("gives every kind a label and a description", () => {
    for (const kind of EXPORT_KINDS) {
      expect(EXPORT_KIND_LABELS[kind]).toBeTruthy();
      expect(EXPORT_KIND_DESCRIPTIONS[kind]).toBeTruthy();
    }
  });

  it("agrees with the insert policy about what staff may request", () => {
    const policy = sql.slice(
      sql.indexOf("create policy export_job_request"),
      sql.indexOf("-- Nobody edits an export by hand"),
    );
    for (const kind of STAFF_EXPORT_KINDS) expect(policy).toContain(`'${kind}'`);
    // The two an administrator alone may ask for.
    expect(policy).not.toContain("'organization_data'");
    expect(policy).not.toContain("'person_data'");
  });
});

describe("the jobs are registered and handled", () => {
  it("has a handler for both export jobs", () => {
    expect(Object.keys(JOB_HANDLERS)).toContain("run-exports");
    expect(Object.keys(JOB_HANDLERS)).toContain("expire-exports");
  });

  it("registers both in job_definition and schedules them", () => {
    const sql = migration("_export_jobs.sql");
    expect(sql).toContain("'run-exports'");
    expect(sql).toContain("'expire-exports'");
    expect(sql).toContain("cron.schedule");
  });
});

describe("requesting one", () => {
  it("refuses a person export with nobody named", () => {
    const result = requestExportSchema.safeParse({ kind: "person_data" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/person this export is about/);
    }
  });

  it("accepts a person export with a subject", () => {
    expect(
      requestExportSchema.safeParse({ kind: "person_data", subjectUserId: PERSON })
        .success,
    ).toBe(true);
  });

  it("does not demand a subject for the other kinds", () => {
    for (const kind of EXPORT_KINDS.filter((k) => k !== "person_data")) {
      expect(requestExportSchema.safeParse({ kind }).success).toBe(true);
    }
  });
});

describe("expiry is decided by the clock, not the status", () => {
  const now = new Date("2026-03-15T12:00:00Z");

  it("refuses a ready export that is already past its date", () => {
    // Expiry is swept by a job, so there is always a window in which a row
    // says ready and the file should no longer be handed over. Trusting the
    // status here would keep serving it until the sweep caught up.
    expect(
      isDownloadable(
        { status: "ready", expires_at: "2026-03-15T11:59:00Z" },
        now,
      ),
    ).toBe(false);
  });

  it("allows a ready export inside its window", () => {
    expect(
      isDownloadable({ status: "ready", expires_at: "2026-03-20T00:00:00Z" }, now),
    ).toBe(true);
  });

  it("never allows any other status", () => {
    for (const status of EXPORT_STATUSES.filter((s) => s !== "ready")) {
      expect(
        isDownloadable(
          { status, expires_at: "2026-03-20T00:00:00Z" },
          now,
        ),
      ).toBe(false);
    }
  });

  it("counts down whole hours and stops at zero", () => {
    expect(hoursUntilExpiry("2026-03-16T12:00:00Z", now)).toBe(24);
    expect(hoursUntilExpiry("2026-03-15T12:30:00Z", now)).toBe(0);
    expect(hoursUntilExpiry("2026-01-01T00:00:00Z", now)).toBe(0);
  });
});

describe("what the database refuses", () => {
  const sql = migration("_export_jobs.sql");

  it("keeps exports unwritable by any signed-in role", () => {
    // The runner writes through the service role. A person moving `status` to
    // 'ready' or pushing `expires_at` out would defeat both the audit trail
    // and the retention rule, so there is no update path at all.
    expect(sql).not.toMatch(/create policy \w+ on export_job for update/);
    expect(sql).not.toMatch(/create policy \w+ on export_job for delete/);
    expect(sql).not.toMatch(/create policy \w+ on export_job for all/);
  });

  it("leaves the bucket unreachable except through the service role", () => {
    expect(sql).toContain("insert into storage.buckets");
    expect(sql).toContain("'exports', 'exports', false");
    expect(sql).not.toMatch(/create policy[^;]*bucket_id = 'exports'/);
  });

  it("insists a ready export has a file and a failure has a reason", () => {
    expect(sql).toContain("ready_exports_have_a_file");
    expect(sql).toContain("failed_exports_say_why");
    expect(sql).toContain("person_exports_name_a_subject");
  });
});
