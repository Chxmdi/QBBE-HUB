import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "@/features/zeffy/tests/zeffy-api.fixture.json";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient, type Row } from "../support/fake-supabase";

let db: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => asClient(db) }));
const runJob = vi.fn(async () => ({ status: "succeeded", runId: "run-1", error: null }));
vi.mock("@/features/jobs/services/runner", async (original) => ({
  ...(await original<typeof import("@/features/jobs/services/runner")>()),
  runJob,
}));
const afterCallbacks: (() => Promise<void>)[] = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => afterCallbacks.push(callback),
}));

const { zeffySync } = await import("@/features/jobs/services/handlers/zeffy-sync");
const { zeffyEvents } = await import("@/features/jobs/services/handlers/zeffy-events");
const { ZeffyClient } = await import("@/features/zeffy/client");
const { syncOrganization, emailHash } = await import("@/features/zeffy/sync");
const { POST } = await import("@/app/api/integrations/zeffy/webhook/route");

const ORG = "org-1";
const NOW = new Date("2026-10-14T12:00:00Z");
const CONNECTION = "zeffy-connection-1";

function definition(name = "zeffy-sync"): JobDefinition {
  return {
    name,
    description: "test",
    schedule: "*/15 * * * *",
    queue: null,
    enabled: true,
    batch_size: 50,
    max_attempts: 3,
  };
}

function zeffyPayment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...fixture.payment,
    id,
    created: 1_760_000_000,
    refunds: [],
    refund_status: "none",
    campaign_category: "donation",
    items: [{ type: "donation", amount: 5000 }],
    ...overrides,
  };
}

function buyer(contact: string, email: string, first = "Jane", last = "Doe") {
  return { contact, buyer: { email, first_name: first, last_name: last, is_corporate: false, company_name: null } };
}

/** A fake Zeffy: lists served in pages of `pageSize`, plus single reads. */
function fakeZeffy(options: {
  payments?: Row[];
  contacts?: Row[];
  campaigns?: Row[];
  pageSize?: number;
  status?: number;
  rateLimitAfter?: number;
}) {
  const calls: string[] = [];
  const lists: Record<string, Row[]> = {
    payments: options.payments ?? [],
    contacts: options.contacts ?? [],
    campaigns: options.campaigns ?? [],
  };
  const fetchMock = vi.fn(async (input: string | URL, _init?: RequestInit) => {
    void _init;
    const url = new URL(String(input));
    calls.push(`${url.pathname}${url.search}`);
    if (options.status) {
      const code = options.status === 401 ? "invalid_api_key" : "internal_error";
      return new Response(JSON.stringify({ error: { code } }), { status: options.status });
    }
    if (options.rateLimitAfter !== undefined && calls.length > options.rateLimitAfter) {
      return new Response("{}", { status: 429, headers: { "retry-after": "60" } });
    }
    const [, , , resource, id] = url.pathname.split("/");
    const list = lists[resource] ?? [];
    if (id) {
      const found = list.find((row) => row.id === id);
      return found
        ? new Response(JSON.stringify(found), { status: 200 })
        : new Response(JSON.stringify({ error: { code: "resource_not_found" } }), { status: 404 });
    }
    const size = options.pageSize ?? 100;
    const after = url.searchParams.get("starting_after");
    const start = after ? list.findIndex((row) => row.id === after) + 1 : 0;
    const page = list.slice(start, start + size);
    const hasMore = start + size < list.length;
    return new Response(
      JSON.stringify({ object: "list", data: page, has_more: hasMore, next_cursor: hasMore ? page.at(-1)?.id : null }),
      { status: 200, headers: { "x-ratelimit-remaining": "90" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, lists, fetchMock };
}

/** The two server-only database functions, as Postgres would answer them. */
function modelDatabaseFunctions(fake: FakeSupabase) {
  fake.onRpc("zeffy_contacts_by_email", (args) => {
    const wanted = (args.p_emails as string[]).map((email) => email.toLowerCase());
    return fake
      .rows("crm_contact")
      .filter((row) => row.organization_id === args.p_organization && typeof row.email === "string")
      .filter((row) => wanted.includes(String(row.email).toLowerCase()))
      .map((row) => ({ id: row.id, email: row.email, zeffy_contact_id: row.zeffy_contact_id ?? null }));
  });
  // public.erase_crm_contact, as far as the sync can see it.
  fake.onRpc("erase_crm_contact", (args) => {
    const contact = fake.rows("crm_contact").find((row) => row.id === args.p_contact);
    if (!contact) return null;
    if (contact.zeffy_contact_id) {
      fake.rows("zeffy_suppressed_contact").push({
        organization_id: contact.organization_id,
        zeffy_contact_id: contact.zeffy_contact_id,
        email_sha256: contact.email ? emailHash(String(contact.email)) : null,
      });
    }
    Object.assign(contact, {
      full_name: "Erased contact", email: null, phone: null, status: "inactive",
      zeffy_contact_id: null, zeffy_kinds: [], details_edited_at: NOW.toISOString(),
    });
    return null;
  });
  fake.onRpc("zeffy_refresh_supporter_kinds", (args) => {
    for (const id of args.p_zeffy_contact_ids as string[]) {
      const counted = fake
        .rows("zeffy_payment")
        .filter((row) => row.organization_id === args.p_organization && row.zeffy_contact_id === id)
        .filter((row) => !row.deleted_at && row.status === "succeeded" && row.refund_status !== "full");
      const kinds = [...new Set(counted.flatMap((row) => row.item_kinds as string[]))].sort();
      const last = counted.map((row) => String(row.paid_at)).sort().at(-1) ?? null;
      for (const contact of fake.rows("crm_contact")) {
        if (contact.organization_id === args.p_organization && contact.zeffy_contact_id === id) {
          contact.zeffy_kinds = kinds;
          contact.zeffy_last_activity_at = last;
        }
      }
    }
    return 0;
  });
}

function seed(fake: FakeSupabase, contacts: Row[] = [], status = "connected") {
  fake.seed("integration_connection", [
    { id: CONNECTION, organization_id: ORG, user_id: null, provider: "zeffy", status },
  ]);
  fake.seed("crm_contact", contacts);
  fake.seed("zeffy_payment", []);
  fake.seed("zeffy_campaign", []);
  fake.seed("zeffy_contact_match", []);
  fake.seed("zeffy_suppressed_contact", []);
  fake.seed("zeffy_sync_state", []);
  fake.seed("zeffy_webhook_event", []);
  fake.seed("background_job_run", []);
  modelDatabaseFunctions(fake);
}

beforeEach(() => {
  db = new FakeSupabase(NOW);
  runJob.mockClear();
  afterCallbacks.length = 0;
  process.env.ZEFFY_API_KEY = "zeffy-test-key";
  process.env.ZEFFY_API_BASE_URL = "https://zeffy.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZEFFY_API_KEY;
  delete process.env.ZEFFY_API_BASE_URL;
  delete process.env.ZEFFY_WEBHOOK_SECRET;
});

describe("zeffy-sync", () => {
  it("skips quietly when Zeffy is not set up in this environment", async () => {
    delete process.env.ZEFFY_API_KEY;
    seed(db);
    const result = await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(result).toEqual({ processed: 0, failed: 0, metadata: { skipped: "ZEFFY_API_KEY is not set" } });
  });

  it("copies payments, links a known supporter by email and creates new ones", async () => {
    seed(db, [
      { id: "hub-jane", organization_id: ORG, full_name: "Jane D.", email: "JANE@example.com", zeffy_contact_id: null, source: "hub" },
    ]);
    const zeffy = fakeZeffy({
      payments: [
        zeffyPayment("pay-1", { ...buyer("zc-jane", "jane@example.com"), campaign_category: "donation" }),
        zeffyPayment("pay-2", { ...buyer("zc-sam", "sam@example.com", "Sam", "Roy"), campaign_category: "event", items: [{ type: "ticket", amount: 3000 }] }),
        zeffyPayment("pay-3", { ...buyer("zc-failed", "nobody@example.com"), status: "failed" }),
      ],
      campaigns: [fixture.campaign],
    });

    const result = await zeffySync({ db: asClient(db), definition: definition(), now: NOW });

    expect(result.failed).toBe(0);
    expect(db.rows("zeffy_payment").map((row) => row.zeffy_id).sort()).toEqual(["pay-1", "pay-2", "pay-3"]);
    const jane = db.rows("crm_contact").find((row) => row.id === "hub-jane");
    expect(jane).toMatchObject({ zeffy_contact_id: "zc-jane", full_name: "Jane D.", zeffy_kinds: ["donor"] });
    const sam = db.rows("crm_contact").find((row) => row.zeffy_contact_id === "zc-sam");
    expect(sam).toMatchObject({ full_name: "Sam Roy", email: "sam@example.com", source: "zeffy", zeffy_kinds: ["ticket"] });
    // A failed payment does not make someone a supporter.
    expect(db.rows("crm_contact").some((row) => row.zeffy_contact_id === "zc-failed")).toBe(false);
    expect(db.rows("zeffy_campaign")).toHaveLength(1);
    expect(db.rows("integration_connection")[0]).toMatchObject({ status: "connected", last_error: null, last_sync_at: NOW.toISOString() });
    expect(db.rows("background_job_run")[0]).toMatchObject({ job_name: "zeffy-sync", status: "succeeded" });
    expect(zeffy.calls[0]).toContain("/api/v1/payments?limit=100");
    expect(zeffy.fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer zeffy-test-key" } });
  });

  it("changes nothing when the same data is synced twice", async () => {
    seed(db);
    fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-1", "a@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    const contactsAfterFirst = db.rows("crm_contact").length;
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(db.rows("crm_contact")).toHaveLength(contactsAfterFirst);
    expect(db.rows("zeffy_payment")).toHaveLength(1);
  });

  it("asks only for what changed since the last complete pass, with a day of overlap", async () => {
    seed(db);
    const zeffy = fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-1", "a@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    zeffy.calls.length = 0;
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    const since = 1_760_000_000 - 24 * 60 * 60;
    expect(zeffy.calls[0]).toContain(`created%5Bgte%5D=${since}`);
  });

  it("never guesses between two contacts with the same email", async () => {
    seed(db, [
      { id: "c-a", organization_id: ORG, full_name: "Jane A", email: "jane@example.com", zeffy_contact_id: null, source: "hub" },
      { id: "c-b", organization_id: ORG, full_name: "Jane B", email: "Jane@Example.com", zeffy_contact_id: null, source: "hub" },
    ]);
    fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-jane", "jane@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(db.rows("crm_contact")).toHaveLength(2);
    expect(db.rows("crm_contact").every((row) => !row.zeffy_contact_id)).toBe(true);
    expect(db.rows("zeffy_contact_match")).toEqual([
      expect.objectContaining({ zeffy_contact_id: "zc-jane", email: "jane@example.com", candidate_ids: ["c-a", "c-b"], resolved_at: null }),
    ]);
  });

  it("stops within its request budget and carries on from the saved cursor", async () => {
    seed(db);
    const payments = Array.from({ length: 5 }, (_, index) =>
      zeffyPayment(`pay-${index}`, buyer(`zc-${index}`, `p${index}@example.com`)),
    );
    const zeffy = fakeZeffy({ payments, pageSize: 2 });

    const first = await syncOrganization(
      { db: asClient(db), organizationId: ORG, now: NOW },
      new ZeffyClient({ apiKey: "k", baseUrl: "https://zeffy.test" }),
      { maxRequests: 2, deadline: Date.now() + 60_000 },
    );
    expect(first.complete).toBe(false);
    expect(db.rows("zeffy_payment")).toHaveLength(4);

    zeffy.calls.length = 0;
    const second = await syncOrganization(
      { db: asClient(db), organizationId: ORG, now: NOW },
      new ZeffyClient({ apiKey: "k", baseUrl: "https://zeffy.test" }),
      { maxRequests: 20, deadline: Date.now() + 60_000 },
    );
    expect(zeffy.calls[0]).toContain("starting_after=pay-3");
    expect(second.complete).toBe(true);
    expect(db.rows("zeffy_payment")).toHaveLength(5);
  });

  it("treats Zeffy's rate limit as a pause, not a failure", async () => {
    seed(db);
    fakeZeffy({
      payments: Array.from({ length: 3 }, (_, index) => zeffyPayment(`pay-${index}`, buyer(`zc-${index}`, `p${index}@example.com`))),
      pageSize: 1,
      rateLimitAfter: 1,
    });
    const result = await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(result.failed).toBe(0);
    expect(db.rows("zeffy_payment")).toHaveLength(1);
    expect(db.rows("integration_connection")[0].status).toBe("connected");
    expect(db.rows("background_job_run")[0]).toMatchObject({ status: "succeeded" });
  });

  it("marks the connection when Zeffy rejects the key", async () => {
    seed(db);
    fakeZeffy({ status: 401 });
    const result = await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(result.failed).toBe(1);
    expect(db.rows("integration_connection")[0]).toMatchObject({
      status: "authentication_expired",
      last_error: "Zeffy responded 401 (invalid_api_key).",
    });
    expect(db.rows("background_job_run")[0]).toMatchObject({ status: "failed" });
  });

  it("leaves an expired or disconnected connection alone", async () => {
    seed(db, [], "authentication_expired");
    const zeffy = fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-1", "a@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(zeffy.calls).toHaveLength(0);
  });
});

describe("zeffy-events", () => {
  function event(id: string, type: string, resource: string, attempts = 0) {
    return { event_id: id, organization_id: ORG, event_type: type, resource_id: resource, attempts, processed_at: null, received_at: NOW.toISOString() };
  }

  it("applies a refund reported by webhook by reading the payment's current state", async () => {
    seed(db);
    fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-1", "a@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(db.rows("crm_contact")[0].zeffy_kinds).toEqual(["donor"]);

    fakeZeffy({ payments: [zeffyPayment("pay-1", { ...buyer("zc-1", "a@example.com"), refund_status: "full", refunds: [{ amount: 5000, status: "succeeded" }] })] });
    db.seed("zeffy_webhook_event", [event("evt-1", "payment.updated", "pay-1")]);
    const result = await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });

    expect(result.processed).toBe(1);
    expect(db.rows("zeffy_payment")[0]).toMatchObject({ refund_status: "full", refunded_cents: 5000 });
    // A fully refunded gift no longer makes someone a donor.
    expect(db.rows("crm_contact")[0].zeffy_kinds).toEqual([]);
    expect(db.rows("zeffy_webhook_event")[0].processed_at).toBe(NOW.toISOString());
  });

  it("marks a payment deleted, and erases a contact Zeffy deleted so it is not imported again", async () => {
    seed(db);
    fakeZeffy({ payments: [zeffyPayment("pay-1", buyer("zc-1", "a@example.com"))] });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    db.seed("zeffy_webhook_event", [
      event("evt-1", "payment.deleted", "pay-1"),
      event("evt-2", "contact.deleted", "zc-1"),
    ]);
    await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });
    expect(db.rows("zeffy_payment")[0].deleted_at).toBe(NOW.toISOString());
    expect(db.rows("crm_contact")).toHaveLength(1);
    expect(db.rows("crm_contact")[0]).toMatchObject({ full_name: "Erased contact", email: null, zeffy_contact_id: null });
    expect(db.rows("zeffy_suppressed_contact")).toMatchObject([{ organization_id: ORG, zeffy_contact_id: "zc-1" }]);

    // A later payment from the same Zeffy contact, or from a new Zeffy
    // identity with the same email, creates nobody and keeps no company.
    fakeZeffy({
      payments: [
        zeffyPayment("pay-2", { ...buyer("zc-1", "a@example.com"), buyer: { email: "a@example.com", first_name: "A", last_name: "B", is_corporate: true, company_name: "A Co" } }),
        zeffyPayment("pay-3", buyer("zc-new", "A@Example.com")),
      ],
    });
    await zeffySync({ db: asClient(db), definition: definition(), now: NOW });
    expect(db.rows("crm_contact")).toHaveLength(1);
    expect(db.rows("crm_contact")[0].email).toBeNull();
    expect(db.rows("zeffy_payment").find((row) => row.zeffy_id === "pay-2")?.company_name ?? null).toBeNull();
  });

  it("only unlinks a contact entered in the Hub when Zeffy deletes its supporter", async () => {
    seed(db, [{ id: "hub-1", organization_id: ORG, full_name: "Typed in the Hub", email: "hub@example.com", zeffy_contact_id: "zc-hub", source: "hub" }]);
    db.seed("zeffy_webhook_event", [event("evt-1", "contact.deleted", "zc-hub")]);
    await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });
    expect(db.rows("crm_contact")[0]).toMatchObject({ full_name: "Typed in the Hub", email: "hub@example.com", zeffy_contact_id: null });
    expect(db.rows("zeffy_suppressed_contact")).toMatchObject([{ zeffy_contact_id: "zc-hub" }]);
  });

  it("does not overwrite a Zeffy supporter someone corrected in the Hub", async () => {
    seed(db, [
      { id: "zef-1", organization_id: ORG, full_name: "Corrected Name", email: "right@example.com", zeffy_contact_id: "zc-zef", source: "zeffy", details_edited_at: NOW.toISOString() },
    ]);
    fakeZeffy({ contacts: [{ ...fixture.contact, id: "zc-zef", first_name: "Wrong", last_name: "Name", email: "wrong@example.com" }] });
    db.seed("zeffy_webhook_event", [event("evt-1", "contact.updated", "zc-zef")]);
    await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });
    expect(db.rows("crm_contact")[0]).toMatchObject({ full_name: "Corrected Name", email: "right@example.com" });
  });

  it("updates details only for supporters the sync created", async () => {
    seed(db, [
      { id: "hub-1", organization_id: ORG, full_name: "Typed in the Hub", email: "hub@example.com", zeffy_contact_id: "zc-hub", source: "hub" },
      { id: "zef-1", organization_id: ORG, full_name: "Old name", email: "old@example.com", zeffy_contact_id: "zc-zef", source: "zeffy" },
    ]);
    fakeZeffy({
      contacts: [
        { ...fixture.contact, id: "zc-hub", first_name: "Changed", last_name: "In Zeffy", email: "new-hub@example.com" },
        { ...fixture.contact, id: "zc-zef", first_name: "New", last_name: "Name", email: "new@example.com" },
      ],
    });
    db.seed("zeffy_webhook_event", [event("evt-1", "contact.updated", "zc-hub"), event("evt-2", "contact.updated", "zc-zef")]);
    await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });
    expect(db.rows("crm_contact").find((row) => row.id === "hub-1")).toMatchObject({ full_name: "Typed in the Hub", email: "hub@example.com" });
    expect(db.rows("crm_contact").find((row) => row.id === "zef-1")).toMatchObject({ full_name: "New Name", email: "new@example.com", phone: "+15141234567" });
  });

  it("retries a failing event and closes it after the last attempt, keeping the error", async () => {
    seed(db);
    fakeZeffy({ status: 500 });
    db.seed("zeffy_webhook_event", [event("evt-1", "payment.updated", "pay-1", 0), event("evt-2", "payment.updated", "pay-2", 11)]);
    const result = await zeffyEvents({ db: asClient(db), definition: definition("zeffy-events"), now: NOW });
    expect(result.failed).toBe(2);
    const [first, last] = db.rows("zeffy_webhook_event");
    expect(first).toMatchObject({ attempts: 1, processed_at: null, last_error: "Zeffy responded 500 (internal_error)." });
    expect(last).toMatchObject({ attempts: 12, processed_at: NOW.toISOString() });
  });
});

describe("the Zeffy webhook", () => {
  const SECRET = "whsec_route_test_secret";

  function deliver(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return POST(
      new Request("https://hub.example/api/integrations/zeffy/webhook", {
        method: "POST",
        body,
        headers: { "zeffy-signature": `t=${timestamp},v1=${signature}` },
      }),
    );
  }

  const completed = (id = "evt-1") =>
    JSON.stringify({ id, type: "payment.completed", version: 1, dispatchedAt: NOW.toISOString(), data: zeffyPayment("pay-w", buyer("zc-w", "w@example.com")) });

  beforeEach(() => {
    process.env.ZEFFY_WEBHOOK_SECRET = SECRET;
    seed(db);
  });

  it("answers 503 until a signing secret is set", async () => {
    delete process.env.ZEFFY_WEBHOOK_SECRET;
    expect((await deliver(completed())).status).toBe(503);
  });

  it("refuses a delivery signed with another secret", async () => {
    expect((await deliver(completed(), "whsec_wrong")).status).toBe(401);
    expect(db.rows("zeffy_webhook_event")).toHaveLength(0);
  });

  it("saves a completed payment at once and records the event", async () => {
    const response = await deliver(completed());
    expect(response.status).toBe(200);
    expect(db.rows("zeffy_payment")).toHaveLength(1);
    expect(db.rows("crm_contact")[0]).toMatchObject({ zeffy_contact_id: "zc-w", source: "zeffy" });
    expect(db.rows("zeffy_webhook_event")[0]).toMatchObject({ event_id: "evt-1", processed_at: expect.any(String) });
    expect(db.rows("zeffy_sync_state")[0].last_webhook_at).toEqual(expect.any(String));
    expect(afterCallbacks).toHaveLength(0);
  });

  it("does nothing the second time Zeffy delivers the same event", async () => {
    await deliver(completed());
    const response = await deliver(completed());
    expect(await response.json()).toEqual({ ok: true, duplicate: true });
    expect(db.rows("zeffy_webhook_event")).toHaveLength(1);
    expect(db.rows("zeffy_payment")).toHaveLength(1);
  });

  it("leaves id-only events to the events job, started right after the answer", async () => {
    const response = await deliver(JSON.stringify({ id: "evt-9", type: "payment.updated", data: { id: "pay-9", object: "payment" } }));
    expect(response.status).toBe(200);
    const stored = db.rows("zeffy_webhook_event")[0];
    expect(stored).toMatchObject({ event_id: "evt-9", event_type: "payment.updated", resource_id: "pay-9" });
    expect(stored.processed_at ?? null).toBeNull();
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(runJob).toHaveBeenCalledWith("zeffy-events");
  });

  it("drops events while no organization is connected; the sync backfills later", async () => {
    db.seed("integration_connection", []);
    const response = await deliver(completed());
    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(db.rows("zeffy_webhook_event")).toHaveLength(0);
  });
});
