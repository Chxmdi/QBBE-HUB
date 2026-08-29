import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeDuration,
  policyIsAllowed,
  savePolicySchema,
  type RetentionSubject,
} from "@/features/retention/schemas";
import {
  SUBJECT_KEYS,
  cutoffFor,
} from "@/features/retention/services/retention-subjects";
import { JOB_HANDLERS } from "@/features/jobs/services/handlers";

function migration(): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((n) => n.endsWith("_retention_policies.sql"));
  if (!file) throw new Error("the retention migration is missing");
  return readFileSync(join(dir, file), "utf8");
}

/** The subject keys seeded into retention_subject, read from the migration. */
function whitelistedSubjects(): string[] {
  const sql = migration();
  const block = sql.slice(
    sql.indexOf("insert into retention_subject"),
    sql.indexOf("on conflict (key)"),
  );
  return [...block.matchAll(/\(\s*'([a-z_]+)',\n/g)].map((m) => m[1]).sort();
}

describe("the whitelist and the handlers are the same list", () => {
  it("has a handler for every governed subject, and no orphans", () => {
    // A subject with no handler is a policy that silently does nothing every
    // night — worse than one that fails, because an administrator would
    // believe their retention rule was working.
    expect([...SUBJECT_KEYS].sort()).toEqual(whitelistedSubjects());
  });

  it("finds the subjects at all, so the check above cannot pass vacuously", () => {
    expect(whitelistedSubjects().length).toBeGreaterThan(3);
  });

  it("registers the sweep and gives it a handler", () => {
    expect(migration()).toContain("'apply-retention'");
    expect(typeof JOB_HANDLERS["apply-retention"]).toBe("function");
  });
});

describe("floors", () => {
  const subject: RetentionSubject = {
    key: "audit_event",
    label: "Audit trail",
    description: "",
    minimum_days: 2190,
    default_days: 2555,
    allowed_actions: ["delete"],
    caution: null,
  };

  it("refuses anything below the subject's floor", () => {
    const result = policyIsAllowed(subject, { retainDays: 30, action: "delete" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/at least 6 years/);
  });

  it("accepts the floor exactly", () => {
    expect(policyIsAllowed(subject, { retainDays: 2190, action: "delete" }).ok).toBe(
      true,
    );
  });

  it("refuses an action the subject does not allow", () => {
    const result = policyIsAllowed(subject, {
      retainDays: 2555,
      action: "anonymise",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cannot be anonymised/);
  });

  it("keeps the audit trail's floor at six years in the database too", () => {
    // If this ever drops, an investigation loses the first thing it asks for.
    const sql = migration();
    const audit = sql.slice(sql.indexOf("('audit_event'"));
    expect(audit).toContain("2190");
  });
});

describe("durations read as durations", () => {
  it("says days, months and years as a person would", () => {
    expect(describeDuration(14)).toBe("14 days");
    expect(describeDuration(90)).toBe("3 months");
    expect(describeDuration(365)).toBe("1 year");
    expect(describeDuration(2190)).toBe("6 years");
    expect(describeDuration(1825)).toBe("5 years");
  });
});

describe("cutoffs", () => {
  it("counts back from now, in whole days", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    expect(cutoffFor(30, now)).toBe("2026-02-13T12:00:00.000Z");
    expect(cutoffFor(365, now)).toBe("2025-03-15T12:00:00.000Z");
  });
});

describe("the form", () => {
  it("reads days typed as text", () => {
    const result = savePolicySchema.safeParse({
      subjectKey: "activity_event",
      retainDays: "365",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.retainDays).toBe(365);
  });

  it("refuses something that is not a number", () => {
    const result = savePolicySchema.safeParse({
      subjectKey: "activity_event",
      retainDays: "forever",
    });
    expect(result.success).toBe(false);
  });

  it("creates a policy switched off unless asked otherwise", () => {
    const result = savePolicySchema.safeParse({
      subjectKey: "activity_event",
      retainDays: 365,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBe(false);
  });
});

describe("what the database enforces", () => {
  const sql = migration();

  it("enforces the floor with a trigger, on update as well as insert", () => {
    expect(sql).toContain("before insert or update on retention_policy");
    expect(sql).toContain("retention_policy_respects_its_subject");
  });

  it("keeps the run log unwritable from the application", () => {
    // A hand-edited retention log is not a log.
    expect(sql).not.toMatch(/create policy \w+ on retention_run for insert/);
    expect(sql).not.toMatch(/create policy \w+ on retention_run for update/);
    expect(sql).not.toMatch(/create policy \w+ on retention_run for delete/);
    expect(sql).not.toMatch(/create policy \w+ on retention_run for all/);
  });

  it("allows one policy per subject per organization", () => {
    expect(sql).toContain("unique (organization_id, subject_key)");
  });
});
