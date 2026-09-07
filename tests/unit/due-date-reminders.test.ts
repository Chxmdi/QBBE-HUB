import { describe, expect, it } from "vitest";
import { dueDateReminders } from "@/features/jobs/services/handlers/due-date-reminders";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient, type Row } from "../support/fake-supabase";

/**
 * What this job promises: everyone who owns dated work hears about it on the
 * day, in their organization's zone, once per state per day.
 *
 * The interesting failure is not a wrong date. It is a backlog: the job reads
 * one batch of the soonest-due open work, and overdue tasks sort first, so a
 * large enough pile of stale overdue work can consume the whole batch and no
 * "due today" reminder is ever sent again — silently, and for every
 * organization at once, because the batch is global.
 */

const NOW = new Date("2026-09-07T12:00:00Z"); // 08:00 in Toronto

function definition(batchSize: number): JobDefinition {
  return {
    name: "due-date-reminders",
    description: "test",
    schedule: "0 12 * * *",
    queue: "notifications",
    enabled: true,
    batch_size: batchSize,
    max_attempts: 3,
  } as JobDefinition;
}

function task(id: string, dueAt: string, org = "org-1", assignee = "user-1"): Row {
  return {
    id,
    organization_id: org,
    title: `Task ${id}`,
    due_at: dueAt,
    assignee_id: assignee,
    priority: "normal",
    status: "in_progress",
    archived_at: null,
  };
}

function seeded(rows: Row[], orgs?: Row[]) {
  const db = new FakeSupabase(NOW);
  db.seed("organization", orgs ?? [{ id: "org-1", timezone: "America/Toronto" }]);
  db.seed("task", rows);
  db.seed("crm_follow_up", []);
  db.seed("notification", []);
  return db;
}

const titles = (db: FakeSupabase) =>
  db.rows("notification").map((n) => String(n.title));

describe("a backlog of overdue work must not silence today's reminders", () => {
  it("still reminds about work due today when older overdue work fills the batch", async () => {
    // Three long-overdue tasks and one due today, with room for two records.
    // Ordered by due date, the overdue three come first and the batch ends
    // before reaching today's.
    const db = seeded([
      task("old-1", "2026-01-01"),
      task("old-2", "2026-01-02"),
      task("old-3", "2026-01-03"),
      task("today-1", "2026-09-07"),
    ]);

    await dueDateReminders({ db: asClient(db), definition: definition(2), now: NOW });

    expect(titles(db)).toContain("Due today: Task today-1");
  });

  it("does not let one organization's backlog silence another's", async () => {
    const db = seeded(
      [
        task("noisy-1", "2026-01-01", "org-1"),
        task("noisy-2", "2026-01-02", "org-1"),
        task("quiet-today", "2026-09-07", "org-2", "user-2"),
      ],
      [
        { id: "org-1", timezone: "America/Toronto" },
        { id: "org-2", timezone: "America/Toronto" },
      ],
    );

    await dueDateReminders({ db: asClient(db), definition: definition(2), now: NOW });

    expect(titles(db)).toContain("Due today: Task quiet-today");
  });

  it("reports when a batch was truncated instead of dropping the work silently", async () => {
    const db = seeded([
      task("old-1", "2026-01-01"),
      task("old-2", "2026-01-02"),
      task("old-3", "2026-01-03"),
    ]);

    const result = await dueDateReminders({
      db: asClient(db),
      definition: definition(2),
      now: NOW,
    });

    // A cap that nobody can see is how a backlog stays invisible. The run
    // record has to say it hit one.
    expect(result.metadata?.overdueTruncated).toBe(true);
  });
});

describe("the day is the organization's, and each state is announced once", () => {
  it("calls a task due today 'due today' rather than overdue", async () => {
    const db = seeded([task("t1", "2026-09-07")]);
    await dueDateReminders({ db: asClient(db), definition: definition(50), now: NOW });
    expect(titles(db)).toEqual(["Due today: Task t1"]);
  });

  it("uses the organization's zone, not the server's", async () => {
    // 2026-09-07T02:00Z is still the 6th in Toronto, so a task due on the 6th
    // is due *today* there while the server's UTC clock says yesterday.
    const late = new Date("2026-09-07T02:00:00Z");
    const db = new FakeSupabase(late);
    db.seed("organization", [{ id: "org-1", timezone: "America/Toronto" }]);
    db.seed("task", [task("t1", "2026-09-06")]);
    db.seed("crm_follow_up", []);
    db.seed("notification", []);

    await dueDateReminders({ db: asClient(db), definition: definition(50), now: late });

    expect(titles(db)).toEqual(["Due today: Task t1"]);
  });

  it("does not send the same state twice in one day", async () => {
    const db = seeded([task("t1", "2026-09-07")]);
    const ctx = { db: asClient(db), definition: definition(50), now: NOW };
    await dueDateReminders(ctx);
    await dueDateReminders(ctx);
    expect(db.rows("notification")).toHaveLength(1);
  });
});
