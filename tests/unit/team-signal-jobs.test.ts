import { describe, expect, it } from "vitest";
import {
  reminderDraft,
  teamSignalDigest,
  teamSignalReminders,
} from "@/features/jobs/services/handlers/team-signals";
import { ATTENTION } from "@/features/people/team-overview";
import { createTranslator } from "@/lib/i18n/translate";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient, type Row } from "../support/fake-supabase";

const ORG = "org-1";
const STAFF = "user-staff";
const OWNER = "user-owner";
const NOW = new Date("2026-09-28T13:20:00Z");

function definition(name: string): JobDefinition {
  return {
    name,
    description: name,
    schedule: "* * * * *",
    queue: null,
    enabled: true,
    batch_size: 50,
    max_attempts: 3,
  } as JobDefinition;
}

function workspace(db: FakeSupabase, settings: Row) {
  db.seed("organization", [{ id: ORG, name: "QBBE", timezone: "America/Toronto" }]);
  db.seed("user_profile", [
    { id: STAFF, full_name: "Sam Rivera", email: "sam@example.org", locale: "fr-CA" },
    { id: OWNER, full_name: "Amara Blake", email: "amara@example.org", locale: null },
  ]);
  db.seed("team_signal_settings", [
    {
      organization_id: ORG,
      overdue_count: 3,
      overdue_age_days: 7,
      blocked_no_update_days: 5,
      in_progress_no_update_days: 7,
      flag_project_reports: true,
      flag_overdue_decisions: true,
      reminders_enabled: false,
      digest_enabled: false,
      ...settings,
    },
  ]);
  db.seed("team_signal", [
    { id: "sig-1", organization_id: ORG, user_id: STAFF, kind: "overdue", reminded_at: null },
    { id: "sig-2", organization_id: ORG, user_id: STAFF, kind: "blocked", reminded_at: null },
  ]);
  db.seed("notification", []);
  db.seed("email_delivery", []);
  db.seed("organization_membership", [
    {
      organization_id: ORG,
      user_id: OWNER,
      role: "owner",
      status: "active",
      user: { full_name: "Amara Blake", email: "amara@example.org", locale: null },
    },
  ]);
}

describe("team-signal-reminders", () => {
  it("does nothing where reminders are switched off", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { reminders_enabled: false });
    const result = await teamSignalReminders({
      db: asClient(db),
      definition: definition("team-signal-reminders"),
      now: NOW,
    });
    expect(result.processed).toBe(0);
    expect(db.rpcCalls.filter((call) => call.name === "sync_team_signals")).toHaveLength(0);
    expect(db.rows("notification")).toHaveLength(0);
  });

  it("sends one gentle reminder per person for new signals, in their language, and records it", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { reminders_enabled: true });
    db.onRpc("sync_team_signals", () => [
      { signal_id: "sig-1", user_id: STAFF, kind: "overdue", item_count: 4, oldest_overdue_days: 12 },
      { signal_id: "sig-2", user_id: STAFF, kind: "blocked", item_count: 1, oldest_overdue_days: null },
    ]);

    const result = await teamSignalReminders({
      db: asClient(db),
      definition: definition("team-signal-reminders"),
      now: NOW,
    });

    expect(result.processed).toBe(1);
    const sync = db.rpcCalls.find((call) => call.name === "sync_team_signals");
    // 09:20 in Montréal: the organization's own date.
    expect(sync?.args).toEqual({ p_organization_id: ORG, p_today: "2026-09-28" });
    const [note] = db.rows("notification");
    expect(note.user_id).toBe(STAFF);
    expect(note.category).toBe("system");
    expect(note.urgency).toBe("low");
    expect(note.link).toBe(`/people/${STAFF}/work`);
    expect(note.dedupe_key).toBe("team-signal:sig-1,sig-2");
    expect(note.title).toBe("Une partie de votre travail mérite peut-être un coup d’œil");
    expect(String(note.body)).toContain("4 tâches en retard");
    expect(db.rows("team_signal").every((row) => row.reminded_at === NOW.toISOString())).toBe(true);
  });

  it("sends nothing when no signal is new", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { reminders_enabled: true });
    db.onRpc("sync_team_signals", () => []);
    const result = await teamSignalReminders({
      db: asClient(db),
      definition: definition("team-signal-reminders"),
      now: NOW,
    });
    expect(result.processed).toBe(0);
    expect(db.rows("notification")).toHaveLength(0);
  });
});

describe("reminderDraft", () => {
  it("states facts with the organization's thresholds, never a judgement", () => {
    const draft = reminderDraft(
      ORG,
      STAFF,
      [
        { signal_id: "b", user_id: STAFF, kind: "in_progress", item_count: 2, oldest_overdue_days: null },
        { signal_id: "a", user_id: STAFF, kind: "decisions", item_count: 1, oldest_overdue_days: null },
      ],
      { ...ATTENTION, inProgressNoUpdateDays: 10 },
      createTranslator("en"),
    );
    expect(draft.body).toBe(
      "2 tasks in progress with no update for 10+ days; 1 decision past due. Your work summary shows the details. This reminder is sent once and does not repeat while things stay as they are.",
    );
    expect(draft.dedupe_key).toBe("team-signal:a,b");
    expect(draft.reason).toBe("work signal");
  });
});

describe("team-signal-digest", () => {
  const listed = {
    user_id: STAFF,
    full_name: "Sam Rivera",
    role: "staff",
    kinds: ["overdue", "decisions"],
    overdue: 4,
    oldest_overdue_days: 12,
    blocked_stale: 0,
    in_progress_stale: 0,
    stale_projects: 0,
    overdue_decisions: 1,
  };

  it("emails each owner and admin the people with signals, once a week", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { digest_enabled: true });
    db.onRpc("team_signal_digest", () => [listed]);

    const run = () =>
      teamSignalDigest({ db: asClient(db), definition: definition("team-signal-digest"), now: NOW });
    const result = await run();

    expect(result.processed).toBe(1);
    const [email] = db.rows("email_delivery");
    expect(email.recipient).toBe("amara@example.org");
    expect(email.kind).toBe("system");
    expect(email.category).toBe("team_digest");
    expect(email.subject).toBe("Team signals: 1 person has work that needs attention");
    expect(String(email.body_text)).toContain("Sam Rivera");
    expect(String(email.body_text)).toContain("4 tasks overdue, oldest 12 days");
    expect(String(email.body_text)).toContain("1 decision past due");
    expect(String(email.body_text)).toContain(`/people/${STAFF}/work`);
    expect(String(email.dedupe_key)).toBe(`team-digest:${ORG}:${OWNER}:2026-W40`);
    expect(db.queue("notifications")).toHaveLength(1);
    expect(db.queue("notifications")[0].message.delivery_id).toBe(email.id);
  });

  it("sends no email when nobody has a signal", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { digest_enabled: true });
    db.onRpc("team_signal_digest", () => []);
    const result = await teamSignalDigest({
      db: asClient(db),
      definition: definition("team-signal-digest"),
      now: NOW,
    });
    expect(result.processed).toBe(0);
    expect(result.metadata?.withoutSignals).toBe(1);
    expect(db.rows("email_delivery")).toHaveLength(0);
  });

  it("does nothing where the digest is switched off", async () => {
    const db = new FakeSupabase(NOW);
    workspace(db, { digest_enabled: false });
    db.onRpc("team_signal_digest", () => [listed]);
    const result = await teamSignalDigest({
      db: asClient(db),
      definition: definition("team-signal-digest"),
      now: NOW,
    });
    expect(result.processed).toBe(0);
    expect(db.rows("email_delivery")).toHaveLength(0);
  });
});
