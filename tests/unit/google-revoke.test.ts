import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const logged: { event: string; fields: Record<string, unknown> }[] = [];
vi.mock("@/lib/server-log", () => ({
  logEvent: (event: string, fields: Record<string, unknown>) => logged.push({ event, fields }),
  logActionFailure: vi.fn(),
}));

const { revokeQueuedGoogleTokens } = await import("@/features/inbox/services/google-revoke");
const { googleTokenUpkeep } = await import("@/features/jobs/services/handlers/google-token-upkeep");
const { openToken, sealToken, isSealed } = await import("@/features/inbox/services/google-token-crypto");

/**
 * Deleted Google tokens are revoked at Google (PRIV-011). Revocation is best
 * effort: whatever Google answers, the queued copy is deleted and the outcome
 * is logged and audited. The upkeep job also seals tokens stored in the clear.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const CONN = "44444444-4444-4444-8444-444444444444";
const savedKey = process.env.GOOGLE_TOKEN_KEY;

let queue: Record<string, unknown>[];
let secrets: Record<string, unknown>[];
let calls: TableCall[];
let auditError: { message: string } | null;
let fetchCalls: { url: string; body: string; method: string }[];
let fetchAnswer: () => Response | Promise<Response>;

function db() {
  const fake = fakeDb({
    table: (call): Answer => {
      if (call.table === "google_token_revocation" && call.action === "select") return { data: queue, error: null };
      if (call.table === "integration_secret" && call.action === "select") return { data: secrets, error: null };
      if (call.table === "audit_event") return { data: null, error: auditError };
      return { data: null, error: null };
    },
  });
  calls = fake.tableCalls;
  return fake.db;
}

beforeEach(() => {
  process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
  logged.length = 0;
  auditError = null;
  fetchCalls = [];
  fetchAnswer = () => new Response("{}", { status: 200 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), body: String(init.body), method: String(init.method) });
    return fetchAnswer();
  });
  queue = [{ id: "q1", connection_id: CONN, organization_id: ORG, user_id: USER, provider: "gmail", token: sealToken("1//refresh", CONN), attempts: 0 }];
  secrets = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.GOOGLE_TOKEN_KEY = savedKey;
});

const deleted = () => calls.filter((c) => c.table === "google_token_revocation" && c.action === "delete");
const audits = () => calls.filter((c) => c.table === "audit_event").map((c) => c.payload as Record<string, unknown>);

describe("revoking deleted Google tokens", () => {
  it("asks Google to revoke the token itself, then deletes the queued copy and audits it", async () => {
    const result = await revokeQueuedGoogleTokens(db());
    expect(fetchCalls).toEqual([
      { url: "https://oauth2.googleapis.com/revoke", method: "POST", body: "token=1%2F%2Frefresh" },
    ]);
    expect(deleted()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({
      organization_id: ORG,
      actor_id: USER,
      event_type: "integration",
      action: "google_token_revoked",
      object_type: "integration_connection",
      object_id: CONN,
      metadata: { provider: "gmail", outcome: "revoked" },
    });
    expect(JSON.stringify(audits())).not.toContain("refresh");
    expect(result).toEqual({ revoked: 1, failed: 0 });
  });

  it("still deletes the queued copy, and audits the failure, when Google refuses", async () => {
    fetchAnswer = () => new Response('{"error":"invalid_token"}', { status: 400 });
    await revokeQueuedGoogleTokens(db());
    expect(deleted()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: "google_token_revoke_failed", metadata: { outcome: "refused", status: 400 } });
  });

  it("tries again next run when Google cannot be reached, and gives up after five tries", async () => {
    fetchAnswer = () => Promise.reject(new TypeError("network down"));
    const result = await revokeQueuedGoogleTokens(db());
    expect(deleted()).toHaveLength(0);
    expect(audits()).toEqual([]);
    expect(calls.find((c) => c.table === "google_token_revocation" && c.action === "update")?.payload).toEqual({ attempts: 1 });
    expect(result).toEqual({ revoked: 0, failed: 1 });
    expect(logged.some((l) => l.event === "google.token_revoke" && l.fields.outcome === "unreachable")).toBe(true);

    queue = [{ ...queue[0], attempts: 4 }];
    await revokeQueuedGoogleTokens(db());
    expect(deleted()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: "google_token_revoke_failed", metadata: { outcome: "unreachable", attempts: 5 } });
    // googleFetch waits between its own retries (1 s, then 2 s) on each call.
  }, 20_000);

  it("deletes a queued token it cannot open (key gone), audited as unreadable, without calling Google", async () => {
    queue = [{ ...queue[0], token: sealToken("x", CONN) }];
    process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
    await revokeQueuedGoogleTokens(db());
    expect(fetchCalls).toEqual([]);
    expect(deleted()).toHaveLength(1);
    expect(audits()[0]).toMatchObject({ action: "google_token_revoke_failed", metadata: { outcome: "unreadable" } });
  });

  it("keeps the queued copy for the next run when the audit record cannot be written", async () => {
    auditError = { message: "audit unavailable" };
    await revokeQueuedGoogleTokens(db());
    expect(fetchCalls).toHaveLength(1);
    expect(deleted()).toHaveLength(0);
  });

  it("revokes only the named connection's tokens when asked to", async () => {
    await revokeQueuedGoogleTokens(db(), { connectionId: CONN });
    const select = calls.find((c) => c.table === "google_token_revocation" && c.action === "select");
    expect(select?.filters).toContainEqual({ op: "eq", column: "connection_id", value: CONN });
  });
});

describe("the google-token-upkeep job", () => {
  it("seals tokens stored in the clear, and running again changes nothing", async () => {
    queue = [];
    secrets = [{ connection_id: CONN, access_token: "ya29.plain", refresh_token: "1//plain" }];
    await googleTokenUpkeep({ db: db(), definition: { batch_size: 200 } as never, now: new Date() });
    const update = calls.find((c) => c.table === "integration_secret" && c.action === "update");
    const written = update?.payload as { access_token: string; refresh_token: string };
    expect(isSealed(written.access_token) && isSealed(written.refresh_token)).toBe(true);
    expect(openToken(written.access_token, CONN)).toBe("ya29.plain");
    expect(openToken(written.refresh_token, CONN)).toBe("1//plain");

    // Written only over the values it read, so a token refreshed meanwhile stays.
    expect(update?.filters).toEqual([
      { op: "eq", column: "connection_id", value: CONN },
      { op: "eq", column: "access_token", value: "ya29.plain" },
      { op: "eq", column: "refresh_token", value: "1//plain" },
    ]);

    secrets = [{ connection_id: CONN, access_token: written.access_token, refresh_token: written.refresh_token }];
    await googleTokenUpkeep({ db: db(), definition: { batch_size: 200 } as never, now: new Date() });
    expect(calls.filter((c) => c.table === "integration_secret" && c.action === "update")).toHaveLength(0);
  });

  it("removes tokens no key can open, and asks the person to reconnect, so they do not hold up the rest", async () => {
    queue = [];
    secrets = [{ connection_id: CONN, access_token: sealToken("x", CONN), refresh_token: null }];
    process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
    const result = await googleTokenUpkeep({ db: db(), definition: { batch_size: 200 } as never, now: new Date() });
    expect(calls.find((c) => c.table === "integration_secret" && c.action === "delete")?.filters).toEqual([
      { op: "eq", column: "connection_id", value: CONN },
    ]);
    expect(calls.find((c) => c.table === "integration_connection" && c.action === "update")?.payload).toMatchObject({ status: "error" });
    expect(result.metadata).toMatchObject({ unreadable: 1, sealed: 0 });
  });

  it("reseals under the new key during a rotation", async () => {
    queue = [];
    const old = process.env.GOOGLE_TOKEN_KEY!;
    const sealed = sealToken("1//refresh", CONN);
    process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString("base64");
    process.env.GOOGLE_TOKEN_KEY_PREVIOUS = old;
    secrets = [{ connection_id: CONN, access_token: sealed, refresh_token: null }];
    await googleTokenUpkeep({ db: db(), definition: { batch_size: 200 } as never, now: new Date() });
    const written = calls.find((c) => c.table === "integration_secret" && c.action === "update")?.payload as { access_token: string };
    delete process.env.GOOGLE_TOKEN_KEY_PREVIOUS;
    expect(openToken(written.access_token, CONN)).toBe("1//refresh");
  });
});
