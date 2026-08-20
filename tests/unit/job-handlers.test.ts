import { describe, expect, it } from "vitest";
import { dailyDigest } from "@/features/jobs/services/handlers/daily-digest";
import { retryFailedEmails } from "@/features/jobs/services/handlers/retry-failed-emails";
import { purgeJobHistory } from "@/features/jobs/services/handlers/purge-job-history";
import { isoWeekKey } from "@/features/jobs/services/handlers/stale-project-sweep";
import { JOB_HANDLERS, JOB_NAMES } from "@/features/jobs/services/handlers";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient, type Row } from "../support/fake-supabase";

process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.org";

const ORG = "org-1";
const USER = "user-1";

function definition(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: "test",
    description: "test",
    schedule: "* * * * *",
    queue: "notifications",
    enabled: true,
    batch_size: 50,
    max_attempts: 5,
    ...overrides,
  };
}

function workspace(db: FakeSupabase, preferences: Row = {}) {
  db.seed("organization", [{ id: ORG, name: "QBBE" }]);
  db.seed("user_profile", [
    { id: USER, full_name: "Amara Blake", email: "amara@example.org" },
  ]);
  db.seed("notification_preference", [
    { user_id: USER, email_digest: true, digest_hour: 8, timezone: "America/Toronto", ...preferences },
  ]);
  db.seed("email_delivery", []);
  db.seed("notification", []);
}

function unread(db: FakeSupabase, count: number, category = "assignment") {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `note-${category}-${index}`,
    user_id: USER,
    organization_id: ORG,
    category,
    title: `${category} ${index}`,
    body: null,
    link: "/my-work",
    urgency: "normal",
    read_at: null,
    created_at: new Date(db.now().getTime() - index * 60_000).toISOString(),
  }));
  db.rows("notification").push(...rows);
}

// 08:00 in Toronto during daylight saving.
const DIGEST_TIME = new Date("2026-08-19T12:00:00Z");

describe("daily-digest", () => {
  it("builds and queues one digest at the recipient's local hour", async () => {
    const db = new FakeSupabase(DIGEST_TIME);
    workspace(db);
    unread(db, 3);

    const result = await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });

    expect(result.processed).toBe(1);
    const [digest] = db.rows("email_delivery");
    expect(digest.kind).toBe("digest");
    expect(digest.status).toBe("queued");
    expect(digest.subject).toBe("3 updates waiting in QBBE Hub");
    expect(db.queue("notifications")).toHaveLength(1);
    expect(db.queue("notifications")[0].message.delivery_id).toBe(digest.id);
  });

  it("does nothing at any other hour", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T13:00:00Z"));
    workspace(db);
    unread(db, 3);

    const result = await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });

    expect(result.processed).toBe(0);
    expect(db.rows("email_delivery")).toHaveLength(0);
  });

  it("sends nothing on a day with nothing to report", async () => {
    const db = new FakeSupabase(DIGEST_TIME);
    workspace(db);

    const result = await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });

    expect(result.processed).toBe(0);
    expect(result.metadata?.skippedEmpty).toBe(1);
    expect(db.rows("email_delivery")).toHaveLength(0);
    expect(db.queue("notifications")).toHaveLength(0);
  });

  it("builds one digest per person per day, however often it runs", async () => {
    const db = new FakeSupabase(DIGEST_TIME);
    workspace(db);
    unread(db, 3);

    await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });
    const second = await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });

    expect(second.processed).toBe(0);
    expect(db.rows("email_delivery")).toHaveLength(1);
  });

  it("skips anyone who has not subscribed", async () => {
    const db = new FakeSupabase(DIGEST_TIME);
    workspace(db, { email_digest: false });
    unread(db, 3);

    const result = await dailyDigest({
      db: asClient(db),
      definition: definition({ name: "daily-digest" }),
      now: db.now(),
    });

    expect(result.processed).toBe(0);
  });
});

describe("retry-failed-emails", () => {
  it("re-queues a delivery abandoned mid-flight", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T18:00:00Z"));
    workspace(db);
    db.rows("email_delivery").push({
      id: "d1",
      organization_id: ORG,
      recipient: "amara@example.org",
      subject: "Stuck",
      dedupe_key: "email:stuck",
      status: "sending",
      attempt: 1,
      updated_at: new Date("2026-08-19T17:30:00Z").toISOString(),
    });

    const result = await retryFailedEmails({
      db: asClient(db),
      definition: definition({ name: "retry-failed-emails" }),
      now: db.now(),
    });

    expect(result.processed).toBe(1);
    expect(db.queue("notifications")).toHaveLength(1);
    expect(db.queue("notifications")[0].message.delivery_id).toBe("d1");
  });

  it("leaves a delivery alone until it has actually stalled", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T18:00:00Z"));
    workspace(db);
    db.rows("email_delivery").push({
      id: "d1",
      organization_id: ORG,
      recipient: "amara@example.org",
      subject: "In flight",
      dedupe_key: "email:inflight",
      status: "sending",
      attempt: 1,
      updated_at: new Date("2026-08-19T17:59:00Z").toISOString(),
    });

    const result = await retryFailedEmails({
      db: asClient(db),
      definition: definition({ name: "retry-failed-emails" }),
      now: db.now(),
    });

    expect(result.processed).toBe(0);
    expect(db.queue("notifications")).toHaveLength(0);
  });

  it("gives up visibly once the attempts are spent", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T18:00:00Z"));
    workspace(db);
    db.rows("email_delivery").push({
      id: "d1",
      organization_id: ORG,
      recipient: "amara@example.org",
      subject: "Hopeless",
      dedupe_key: "email:hopeless",
      status: "sending",
      attempt: 5,
      updated_at: new Date("2026-08-19T17:00:00Z").toISOString(),
    });

    const result = await retryFailedEmails({
      db: asClient(db),
      definition: definition({ name: "retry-failed-emails", max_attempts: 5 }),
      now: db.now(),
    });

    expect(result.failed).toBe(1);
    expect(db.rows("email_delivery")[0].status).toBe("failed");
    expect(db.queue("notifications")).toHaveLength(0);
  });

  it("rescues a notification the trigger never managed to enqueue", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T18:00:00Z"));
    workspace(db);
    db.rows("notification").push({
      id: "orphan-1",
      user_id: USER,
      organization_id: ORG,
      category: "assignment",
      urgency: "normal",
      dedupe_key: "assign:orphan",
      created_at: new Date("2026-08-19T17:00:00Z").toISOString(),
    });

    const result = await retryFailedEmails({
      db: asClient(db),
      definition: definition({ name: "retry-failed-emails" }),
      now: db.now(),
    });

    expect(result.processed).toBe(1);
    expect(db.queue("notifications")[0].message.notification_id).toBe("orphan-1");
  });
});

describe("purge-job-history", () => {
  it("keeps failures longer than successes", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T06:00:00Z"));
    const daysAgo = (days: number) =>
      new Date(db.now().getTime() - days * 86_400_000).toISOString();

    db.seed("job_run", [
      { id: "r1", job_name: "x", status: "succeeded", started_at: daysAgo(45) },
      { id: "r2", job_name: "x", status: "succeeded", started_at: daysAgo(10) },
      { id: "r3", job_name: "x", status: "failed", started_at: daysAgo(45) },
      { id: "r4", job_name: "x", status: "failed", started_at: daysAgo(200) },
    ]);
    db.seed("email_delivery", []);

    const result = await purgeJobHistory({
      db: asClient(db),
      definition: definition({ name: "purge-job-history" }),
      now: db.now(),
    });

    expect(result.processed).toBe(2);
    const remaining = db.rows("job_run").map((row) => row.id);
    expect(remaining).toEqual(["r2", "r3"]);
  });
});

describe("isoWeekKey", () => {
  it("gives every day of a week the same key", () => {
    const monday = isoWeekKey(new Date("2026-08-17T00:00:00Z"));
    const sunday = isoWeekKey(new Date("2026-08-23T23:00:00Z"));
    expect(monday).toBe(sunday);
    expect(monday).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("moves to a new key in the next week", () => {
    expect(isoWeekKey(new Date("2026-08-23T23:00:00Z"))).not.toBe(
      isoWeekKey(new Date("2026-08-24T00:00:00Z")),
    );
  });
});

describe("the registry", () => {
  it("registers a handler for every scheduled job", () => {
    // These names must match `job_definition` in the database; the runner
    // refuses anything absent from either side.
    expect(JOB_NAMES.sort()).toEqual(
      [
        "announcement-nudge",
        "daily-digest",
        "drain-notifications",
        "due-date-reminders",
        "gmail-watch-renew",
        "google-sync",
        "purge-job-history",
        "retry-failed-emails",
        "scheduled-announcements",
        "stale-project-sweep",
        "vms-sync",
      ].sort(),
    );
    for (const name of JOB_NAMES) {
      expect(typeof JOB_HANDLERS[name]).toBe("function");
    }
  });
});
