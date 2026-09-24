import { afterEach, describe, expect, it, vi } from "vitest";
import { gmailPushSync } from "@/features/jobs/services/handlers/gmail-push-sync";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient } from "../support/fake-supabase";

afterEach(() => vi.unstubAllGlobals());

const ORG = "org-1";
const USER = "user-1";
const CONNECTION = "gmail-connection-1";

function definition(): JobDefinition {
  return {
    name: "gmail-push-sync",
    description: "test",
    schedule: "* * * * *",
    queue: "integrations",
    enabled: true,
    batch_size: 25,
    max_attempts: 5,
  };
}

function seedConnection(db: FakeSupabase, pending: string | null = "101") {
  db.seed("integration_connection", [{
    id: CONNECTION,
    organization_id: ORG,
    user_id: USER,
    provider: "gmail",
    status: "connected",
    last_error: null,
  }]);
  db.seed("integration_secret", [{
    connection_id: CONNECTION,
    access_token: "access-token",
    refresh_token: "refresh-token",
    token_expires_at: new Date(db.now().getTime() + 60 * 60_000).toISOString(),
    gmail_history_id: "100",
    gmail_pending_history_id: pending,
  }]);
  db.seed("gmail_message", []);
}

describe("gmail-push-sync", () => {
  it("turns an authenticated push queue item into immediate history reconciliation", async () => {
    const db = new FakeSupabase(new Date("2026-09-24T05:00:00Z"));
    seedConnection(db);
    db.enqueueRaw("integrations", { kind: "gmail_push", connection_id: CONNECTION, history_id: "101" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        history: [{ messagesAdded: [{ message: { id: "message-1" } }] }],
        historyId: "101",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "message-1",
        threadId: "thread-1",
        snippet: "New message",
        internalDate: "1780000000000",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "partner@example.org" },
            { name: "Subject", value: "Partnership" },
          ],
        },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await gmailPushSync({
      db: asClient(db),
      definition: definition(),
      now: db.now(),
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.queue("integrations")).toHaveLength(0);
    expect(db.rows("gmail_message")).toEqual([
      expect.objectContaining({
        connection_id: CONNECTION,
        external_id: "message-1",
        subject: "Partnership",
      }),
    ]);
    expect(db.rows("integration_secret")[0]).toMatchObject({
      gmail_history_id: "101",
      gmail_pending_history_id: null,
    });
    expect(db.rows("integration_connection")[0]).toMatchObject({
      status: "connected",
      last_error: null,
      last_sync_at: "2026-09-24T05:00:00.000Z",
    });
  });

  it("acks an at-least-once duplicate after another worker already cleared the pending marker", async () => {
    const db = new FakeSupabase(new Date("2026-09-24T05:00:00Z"));
    seedConnection(db, null);
    db.enqueueRaw("integrations", { kind: "gmail_push", connection_id: CONNECTION, history_id: "101" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await gmailPushSync({
      db: asClient(db),
      definition: definition(),
      now: db.now(),
    });

    expect(result.processed).toBe(0);
    expect(result.metadata?.resolved).toBe(1);
    expect(db.queue("integrations")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
