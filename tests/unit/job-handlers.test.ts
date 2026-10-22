import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dailyDigest } from "@/features/jobs/services/handlers/daily-digest";
import { retryFailedEmails } from "@/features/jobs/services/handlers/retry-failed-emails";
import { purgeJobHistory } from "@/features/jobs/services/handlers/purge-job-history";
import { scheduledAnnouncements } from "@/features/jobs/services/handlers/scheduled-announcements";
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
  const NOW = new Date("2026-08-19T06:00:00Z");
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

  async function purge(db: FakeSupabase) {
    return purgeJobHistory({
      db: asClient(db),
      definition: definition({ name: "purge-job-history" }),
      now: db.now(),
    });
  }

  function seedJobs(db: FakeSupabase, runs: Row[]) {
    db.seed(
      "job_definition",
      [...new Set(runs.map((run) => run.job_name as string))].map((name) => ({ name })),
    );
    db.seed("job_run", runs);
    db.seed("email_delivery", []);
    db.seed("rate_limit_counter", []);
    db.seed("background_job_run", []);
  }

  const run = (id: string, job: string, status: string, days: number, processed = 1) => ({
    id,
    job_name: job,
    status,
    started_at: daysAgo(days),
    processed_count: processed,
    failed_count: 0,
  });

  it("keeps successful runs 7 days and failed runs 180 days (OPS-001)", async () => {
    const db = new FakeSupabase(NOW);
    seedJobs(db, [
      run("latest", "x", "succeeded", 0.1),
      run("ok-8d", "x", "succeeded", 8),
      run("ok-6d", "x", "succeeded", 6),
      run("fail-45d", "x", "failed", 45),
      run("fail-200d", "x", "failed", 200),
    ]);

    const result = await purge(db);

    expect(db.rows("job_run").map((row) => row.id).sort()).toEqual(
      ["fail-45d", "latest", "ok-6d"].sort(),
    );
    expect(result.metadata?.runs).toBe(2);
  });

  it("keeps successful runs that did nothing for one day only (OPS-001)", async () => {
    const db = new FakeSupabase(NOW);
    seedJobs(db, [
      run("latest", "drain", "succeeded", 0.01, 0),
      run("idle-2d", "drain", "succeeded", 2, 0),
      run("idle-12h", "drain", "succeeded", 0.5, 0),
      run("busy-2d", "drain", "succeeded", 2, 4),
    ]);

    await purge(db);

    expect(db.rows("job_run").map((row) => row.id).sort()).toEqual(
      ["busy-2d", "idle-12h", "latest"].sort(),
    );
  });

  it("keeps a run that did nothing but processed a failure", async () => {
    const db = new FakeSupabase(NOW);
    seedJobs(db, [
      run("latest", "drain", "succeeded", 0.01, 0),
      { ...run("partial-2d", "drain", "succeeded", 2, 0), failed_count: 3 },
    ]);

    await purge(db);

    expect(db.rows("job_run").map((row) => row.id)).toContain("partial-2d");
  });

  it("never removes the latest run of a job, so Admin > Jobs can still show it", async () => {
    const db = new FakeSupabase(NOW);
    seedJobs(db, [
      // A weekly job whose last run found nothing to do.
      run("weekly-last", "stale-project-sweep", "succeeded", 6, 0),
      run("weekly-before", "stale-project-sweep", "succeeded", 13, 0),
      // A job that has not run for months.
      run("old-last", "vms-sync", "succeeded", 40),
    ]);

    await purge(db);

    expect(db.rows("job_run").map((row) => row.id).sort()).toEqual(
      ["old-last", "weekly-last"].sort(),
    );
  });

  it("trims the per-organization ledger: successes after 30 days, failures after 180", async () => {
    const db = new FakeSupabase(NOW);
    seedJobs(db, []);
    db.seed("background_job_run", [
      { id: "b-ok-10d", status: "succeeded", finished_at: daysAgo(10) },
      { id: "b-ok-40d", status: "succeeded", finished_at: daysAgo(40) },
      { id: "b-fail-40d", status: "failed", finished_at: daysAgo(40) },
      { id: "b-fail-200d", status: "failed", finished_at: daysAgo(200) },
    ]);

    const result = await purge(db);

    expect(db.rows("background_job_run").map((row) => row.id).sort()).toEqual(
      ["b-fail-40d", "b-ok-10d"].sort(),
    );
    expect(result.metadata?.ledger).toBe(2);
  });
});

describe("scheduled-announcements", () => {
  it("records a ledger row only for a pass that notified someone (OPS-001)", async () => {
    const db = new FakeSupabase(new Date("2026-08-19T12:00:00Z"));
    db.seed("announcement", [
      {
        id: "ann-1",
        organization_id: ORG,
        title: "Board meeting moved",
        priority: "normal",
        created_by: USER,
        publish_at: "2026-08-19T11:00:00Z",
        message_id: "msg-1",
      },
    ]);
    db.seed("organization_membership", [
      { organization_id: ORG, user_id: USER, status: "active" },
      { organization_id: ORG, user_id: "user-2", status: "active" },
      { organization_id: ORG, user_id: "user-3", status: "active" },
    ]);
    db.seed("user_profile", [
      { id: "user-2", locale: "fr-CA" },
      { id: "user-3", locale: "en" },
    ]);
    db.seed("notification", []);
    db.seed("background_job_run", []);

    const context = () => ({
      db: asClient(db),
      definition: definition({ name: "scheduled-announcements" }),
      now: db.now(),
    });

    const first = await scheduledAnnouncements(context());
    expect(first.processed).toBe(2);
    expect(db.rows("background_job_run")).toHaveLength(1);

    // Every five minutes for two days the same announcement is looked at again
    // and, rightly, nobody is notified twice. Those passes must not add rows.
    const second = await scheduledAnnouncements(context());
    const third = await scheduledAnnouncements(context());
    expect(second.processed).toBe(0);
    expect(third.processed).toBe(0);
    expect(db.rows("background_job_run")).toHaveLength(1);
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
  /**
   * The names registered in SQL, read out of the migrations.
   *
   * This used to be a hand-written list, which only ever caught one direction:
   * a new handler without a definition. The direction that actually breaks
   * production is the other one — a `job_definition` row with no handler is a
   * cron entry firing into nothing every few minutes, and a hand-written list
   * cannot see it. Reading the migrations catches both.
   */
  function registeredJobNames(): string[] {
    const dir = "supabase/migrations";
    const names = new Set<string>();

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, file), "utf8").replaceAll("insert into public.job_definition", "insert into job_definition");
      let from = sql.indexOf("insert into job_definition");
      while (from !== -1) {
        // The value tuples run until `on conflict` or the statement's end,
        // whichever comes first.
        const conflict = sql.indexOf("on conflict", from);
        const semicolon = sql.indexOf(";", from);
        const end = Math.min(
          conflict === -1 ? semicolon : conflict,
          semicolon === -1 ? sql.length : semicolon,
        );
        for (const match of sql.slice(from, end).matchAll(/\(\s*'([a-z0-9-]+)'/g)) {
          names.add(match[1]);
        }
        from = sql.indexOf("insert into job_definition", end);
      }
    }
    return [...names].sort();
  }

  it("has a handler for every job registered in the migrations", () => {
    // The runner refuses a name absent from either side, so a mismatch here is
    // a job that silently never runs or a schedule that fires into nothing.
    expect(JOB_NAMES.sort()).toEqual(registeredJobNames());
    for (const name of JOB_NAMES) {
      expect(typeof JOB_HANDLERS[name]).toBe("function");
    }
  });

  it("finds the definitions at all, so the check above cannot pass vacuously", () => {
    expect(registeredJobNames().length).toBeGreaterThan(5);
  });
});
