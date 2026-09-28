import { describe, expect, it } from "vitest";
import { describeSchedule } from "@/features/jobs/services/cron";
import { dueDateReminders } from "@/features/jobs/services/handlers/due-date-reminders";
import { runLabel } from "@/features/jobs/services/run-health";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { describeDuration, policyIsAllowed } from "@/features/retention/schemas";
import { describePeriod } from "@/features/record-retention/schemas";
import { createTranslator } from "@/lib/i18n/translate";
import { FakeSupabase, asClient } from "../../../../tests/support/fake-supabase";

/**
 * Reminders reach each person in their own saved language (#141), and the
 * operator's labels read in French when asked, without changing English.
 */

const NOW = new Date("2026-09-07T12:00:00Z");
const fr = createTranslator("fr-CA");

function seeded(locale: string | null) {
  const db = new FakeSupabase(NOW);
  db.seed("organization", [{ id: "org-1", timezone: "America/Toronto" }]);
  db.seed("user_profile", [{ id: "user-1", locale }]);
  db.seed("task", [
    {
      id: "t1",
      organization_id: "org-1",
      title: "Budget",
      due_at: "2026-09-01",
      assignee_id: "user-1",
      priority: "normal",
      status: "in_progress",
      archived_at: null,
    },
  ]);
  db.seed("crm_follow_up", []);
  db.seed("notification", []);
  return db;
}

const definition = {
  name: "due-date-reminders",
  description: "test",
  schedule: "0 12 * * *",
  queue: "notifications",
  enabled: true,
  batch_size: 10,
  max_attempts: 3,
} as JobDefinition;

describe("reminders use the recipient's saved language", () => {
  it("writes French for someone who chose French", async () => {
    const db = seeded("fr-CA");
    await dueDateReminders({ db: asClient(db), definition, now: NOW });
    const [row] = db.rows("notification");
    expect(row.title).toBe("En retard : Budget");
    expect(String(row.body)).toContain("1 sept. 2026");
  });

  it("keeps English, word for word, when no language is saved", async () => {
    const db = seeded(null);
    await dueDateReminders({ db: asClient(db), definition, now: NOW });
    const [row] = db.rows("notification");
    expect(row.title).toBe("Overdue: Budget");
    expect(row.body).toBe("This was due 2026-09-01. Update the due date or move it forward.");
  });
});

describe("operator labels in French", () => {
  it("describes schedules and runs", () => {
    expect(describeSchedule("0 12 * * *", fr)).toBe("Tous les jours à 12 h 00 UTC");
    expect(describeSchedule("0 11 * * 1-5", fr)).toBe("En semaine à 11 h 00 UTC");
    expect(runLabel("partial", { status: "succeeded", processedCount: 5, failedCount: 2 }, fr)).toBe(
      "2 en échec",
    );
  });

  it("describes retention periods", () => {
    expect(describeDuration(90, fr)).toBe("3 mois");
    expect(describeDuration(2190, fr)).toBe("6 ans");
    expect(describePeriod({ retention_basis: "fiscal_year_end" }, 6, fr)).toBe(
      "6 ans après la fin de l’exercice",
    );
    const result = policyIsAllowed(
      {
        key: "audit_event",
        label: "Journal d’audit",
        description: "",
        minimum_days: 2190,
        default_days: 2555,
        allowed_actions: ["delete"],
        caution: null,
      },
      { retainDays: 30, action: "delete" },
      fr,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("au moins 6 ans");
  });
});
