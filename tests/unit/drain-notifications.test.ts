import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainNotifications } from "@/features/jobs/services/handlers/drain-notifications";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient, type Row } from "../support/fake-supabase";

/**
 * The delivery guarantees, exercised against the real handler.
 *
 * Each test states an operational promise the runtime makes and then breaks
 * things until the promise either holds or does not: a killed worker, a
 * duplicated message, a provider outage, a permanently bad address, and a
 * recipient asleep.
 */

process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.org";
process.env.EMAIL_PROVIDER_API_KEY = "test-key";
process.env.EMAIL_FROM_ADDRESS = "QBBE Hub <hub@example.org>";

const ORG = "org-1";
const USER = "user-1";
const START = new Date("2026-08-19T18:00:00Z"); // 14:00 in Toronto

const DEFINITION: JobDefinition = {
  name: "drain-notifications",
  description: "test",
  schedule: "* * * * *",
  queue: "notifications",
  enabled: true,
  batch_size: 25,
  max_attempts: 5,
};

let sends: { to: string; subject: string }[] = [];

/** A provider that succeeds, unless a test tells it otherwise. */
function stubProvider(
  handler: (body: Row) => { ok: true } | { ok: false; status: number },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Row;
      const outcome = handler(body);
      if (!outcome.ok) {
        return new Response("rejected", { status: outcome.status });
      }
      sends.push({
        to: (body.to as string[])[0],
        subject: body.subject as string,
      });
      return new Response(JSON.stringify({ id: `provider-${sends.length}` }), {
        status: 200,
      });
    }),
  );
}

function seedWorkspace(db: FakeSupabase, preferences: Row = {}) {
  db.seed("organization", [{ id: ORG, name: "QBBE" }]);
  db.seed("user_profile", [
    { id: USER, full_name: "Amara Blake", email: "amara@example.org" },
  ]);
  db.seed("notification_preference", [{ user_id: USER, ...preferences }]);
  db.seed("email_delivery", []);
}

/** Creates a notification and puts it on the queue, as the trigger would. */
function raiseNotification(db: FakeSupabase, overrides: Row = {}): string {
  const id = `note-${db.rows("notification").length + 1}`;
  const row: Row = {
    id,
    user_id: USER,
    organization_id: ORG,
    category: "assignment",
    title: "Draft the funding letter",
    body: "Due Friday",
    link: "/my-work?task=t1",
    urgency: "normal",
    dedupe_key: `assign:t1:${id}`,
    created_at: db.now().toISOString(),
    read_at: null,
    ...overrides,
  };
  db.rows("notification").push(row);
  db.enqueueRaw("notifications", {
    kind: "notification",
    notification_id: row.id,
    user_id: row.user_id,
    category: row.category,
    urgency: row.urgency,
    dedupe_key: row.dedupe_key,
  });
  return String(row.id);
}

const run = (db: FakeSupabase) =>
  drainNotifications({ db: asClient(db), definition: DEFINITION, now: db.now() });

const deliveries = (db: FakeSupabase) => db.rows("email_delivery");

beforeEach(() => {
  sends = [];
  stubProvider(() => ({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a real assignment produces a real email", () => {
  it("sends it, records it, and clears the queue", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    raiseNotification(db);

    const result = await run(db);

    expect(result.processed).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe("amara@example.org");
    expect(sends[0].subject).toBe("Draft the funding letter");

    const [row] = deliveries(db);
    expect(row.status).toBe("sent");
    expect(row.provider).toBe("resend");
    expect(row.provider_message_id).toBe("provider-1");
    expect(row.sent_at).toBeTruthy();

    expect(db.queue("notifications")).toHaveLength(0);
  });

  it("puts a working deep link in the body", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    raiseNotification(db);
    await run(db);

    const [row] = deliveries(db);
    expect(row.body_text).toContain("https://hub.example.org/my-work?task=t1");
    expect(row.body_html).toContain("https://hub.example.org/my-work?task=t1");
  });
});

describe("a killed worker loses nothing", () => {
  it("leaves the message on the queue and delivers it once on recovery", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    raiseNotification(db);

    // The process dies mid-send: the provider call never completes.
    stubProvider(() => {
      throw new Error("process terminated");
    });
    const crashed = await run(db);

    expect(crashed.processed).toBe(0);
    expect(crashed.failed).toBe(1);
    expect(sends).toHaveLength(0);
    // Not acknowledged — still on the queue, merely hidden.
    expect(db.queue("notifications")).toHaveLength(1);
    expect(db.visible("notifications")).toHaveLength(0);
    expect(deliveries(db)[0].status).toBe("queued");

    // The visibility timeout lapses and a healthy worker picks it up.
    db.advance(121);
    stubProvider(() => ({ ok: true }));
    const recovered = await run(db);

    expect(recovered.processed).toBe(1);
    expect(sends).toHaveLength(1);
    expect(deliveries(db)).toHaveLength(1);
    expect(deliveries(db)[0].status).toBe("sent");
    expect(db.queue("notifications")).toHaveLength(0);
  });
});

describe("delivery is exactly once", () => {
  it("ignores a duplicated queue message", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    const id = raiseNotification(db);

    // The same notification enqueued twice — a retry that in fact succeeded.
    db.enqueueRaw("notifications", { kind: "notification", notification_id: id });

    await run(db);

    expect(sends).toHaveLength(1);
    expect(deliveries(db)).toHaveLength(1);
    expect(db.queue("notifications")).toHaveLength(0);
  });

  it("does not re-send on a later run", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    const id = raiseNotification(db);
    await run(db);

    db.enqueueRaw("notifications", { kind: "notification", notification_id: id });
    await run(db);

    expect(sends).toHaveLength(1);
    expect(deliveries(db)).toHaveLength(1);
  });
});

describe("a message that cannot be delivered ends up in the archive", () => {
  it("dead-letters after the attempt limit and marks the ledger failed", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    raiseNotification(db);

    // The provider is down. 503 is retryable.
    stubProvider(() => ({ ok: false, status: 503 }));

    for (let attempt = 1; attempt <= DEFINITION.max_attempts; attempt += 1) {
      await run(db);
      if (attempt < DEFINITION.max_attempts) {
        expect(db.queue("notifications")).toHaveLength(1);
        expect(db.archive("notifications")).toHaveLength(0);
        db.advance(121);
      }
    }

    expect(sends).toHaveLength(0);
    expect(db.queue("notifications")).toHaveLength(0);
    expect(db.archive("notifications")).toHaveLength(1);

    const [row] = deliveries(db);
    expect(row.status).toBe("failed");
    expect(row.attempt).toBe(DEFINITION.max_attempts);
    expect(String(row.last_error)).toContain("503");
  });

  it("does not waste attempts on a permanent rejection", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    raiseNotification(db);

    // 422 means the address or the message is wrong; retrying cannot help.
    stubProvider(() => ({ ok: false, status: 422 }));
    const result = await run(db);

    expect(result.failed).toBe(1);
    expect(db.archive("notifications")).toHaveLength(1);
    expect(deliveries(db)[0].status).toBe("bounced");
    expect(deliveries(db)[0].attempt).toBe(1);
  });
});

describe("quiet hours delay mail, they do not delete it", () => {
  const QUIET = { quiet_hours_start: 22, quiet_hours_end: 7, email_critical: false };
  // 02:00 in Toronto.
  const NIGHT = new Date("2026-08-19T06:00:00Z");

  it("holds routine mail and releases it when the window ends", async () => {
    const db = new FakeSupabase(NIGHT);
    seedWorkspace(db, QUIET);
    raiseNotification(db);

    const held = await run(db);

    expect(sends).toHaveLength(0);
    expect(held.metadata?.deferred).toBe(1);
    const [row] = deliveries(db);
    expect(row.status).toBe("queued");
    expect(row.scheduled_for).toBeTruthy();

    // Still hidden while the window is open.
    expect(db.visible("notifications")).toHaveLength(0);

    // Morning.
    db.advance(6 * 3600);
    const released = await run(db);

    expect(released.processed).toBe(1);
    expect(sends).toHaveLength(1);
    expect(deliveries(db)).toHaveLength(1);
    expect(deliveries(db)[0].status).toBe("sent");
  });

  it("still delivers a required announcement in the middle of the night", async () => {
    const db = new FakeSupabase(NIGHT);
    seedWorkspace(db, { ...QUIET, email_announcements: false });
    raiseNotification(db, {
      category: "announcement",
      urgency: "high",
      title: "Closure Monday — please acknowledge",
      dedupe_key: "announcement:a1:user-1",
    });

    const result = await run(db);

    expect(result.processed).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0].subject).toBe("Closure Monday — please acknowledge");
  });
});

describe("preferences are honoured and recorded", () => {
  it("records a suppression instead of sending", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db, { email_assignments: false });
    raiseNotification(db);

    await run(db);

    expect(sends).toHaveLength(0);
    const [row] = deliveries(db);
    expect(row.status).toBe("suppressed");
    expect(row.suppressed_reason).toBe("preference:email_assignments");
    expect(db.queue("notifications")).toHaveLength(0);
  });
});

describe("malformed work does not jam the queue", () => {
  it("archives a payload it cannot route", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    db.enqueueRaw("notifications", { kind: "mystery" });

    const result = await run(db);

    expect(result.failed).toBe(1);
    expect(db.queue("notifications")).toHaveLength(0);
    expect(db.archive("notifications")).toHaveLength(1);
  });

  it("acknowledges a notification that no longer exists", async () => {
    const db = new FakeSupabase(START);
    seedWorkspace(db);
    db.enqueueRaw("notifications", {
      kind: "notification",
      notification_id: "deleted-1",
    });

    await run(db);

    expect(sends).toHaveLength(0);
    expect(db.queue("notifications")).toHaveLength(0);
    expect(deliveries(db)).toHaveLength(0);
  });
});
