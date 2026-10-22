import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type TableCall } from "@/lib/objects/testing/fake-db";
import { hashToken } from "../token";

/**
 * What /api/v1 writes. A call nobody authenticated (module switched off, no
 * token, unknown token, rate-limited address) must not add a row anywhere:
 * otherwise anyone can grow the database one row per request.
 */

const state = vi.hoisted(() => ({
  enabled: true,
  addressAllowed: true,
  db: null as unknown,
  serviceThrows: false,
}));

vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => state.enabled }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async ({ action }: { action: string }) =>
    action === "api:v1:address" ? { allowed: state.addressAllowed } : { allowed: true },
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    if (state.serviceThrows) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    return state.db;
  },
}));

const { apiRoute, apiJson } = await import("../services/api-handler");

const TOKEN = `qbbe_${"a".repeat(43)}`;
const ORG = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";

let calls: TableCall[];
function useDb() {
  const fake = fakeDb({
    table: (call) => {
      if (call.table === "api_token" && call.action === "select") {
        const known = call.filters.some((f) => f.column === "token_hash" && f.value === hashToken(TOKEN));
        return {
          data: known
            ? { id: "tok-1", user_id: PERSON, organization_id: ORG, scopes: ["objects:read"], expires_at: "2999-01-01T00:00:00Z", revoked_at: null }
            : null,
          error: null,
        };
      }
      if (call.table === "organization_membership") return { data: { user_id: PERSON }, error: null };
      return { data: null, error: null };
    },
  });
  state.db = fake.db;
  calls = fake.tableCalls;
}

const route = apiRoute("objects:read", async () => apiJson({ data: "ok" }));
const call = (headers: Record<string, string> = {}) =>
  route(new Request("https://hub.test/api/v1/me", { headers }), { params: Promise.resolve({}) });
const logRows = () => calls.filter((c) => c.table === "api_request_log" && c.action === "insert");

beforeEach(() => {
  state.enabled = true;
  state.addressAllowed = true;
  state.serviceThrows = false;
  useDb();
});

describe("apiRoute logging", () => {
  it("writes nothing while the module is switched off", async () => {
    state.enabled = false;
    const response = await call({ authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(404);
    expect(calls.filter((c) => c.action !== "select")).toEqual([]);
  });

  it("writes nothing for a call without a token", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(logRows()).toEqual([]);
  });

  it("writes nothing for an unknown token", async () => {
    const response = await call({ authorization: `Bearer qbbe_${"b".repeat(43)}` });
    expect(response.status).toBe(401);
    expect(calls.filter((c) => c.action !== "select")).toEqual([]);
  });

  it("writes nothing for a rate-limited address", async () => {
    state.addressAllowed = false;
    const response = await call({ authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(429);
    expect(logRows()).toEqual([]);
  });

  it("logs a call once its token has authenticated", async () => {
    const response = await call({ authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(200);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0].payload).toMatchObject({ token_id: "tok-1", organization_id: ORG, user_id: PERSON, status: 200 });
  });

  it("answers a JSON 500, not a crash, when the server is misconfigured", async () => {
    state.serviceThrows = true;
    const response = await call({ authorization: `Bearer ${TOKEN}` });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal", message: "Something went wrong." } });
  });
});
