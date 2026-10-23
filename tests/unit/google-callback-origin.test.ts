import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openToken } from "@/features/inbox/services/google-token-crypto";

const USER = "55555555-5555-4555-8555-555555555555";
const ORG = "44444444-4444-4444-8444-444444444444";
const CONNECTION = "66666666-6666-4666-8666-666666666666";

let stateCookie: string | undefined;
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: null; error: null }>>(
  async () => ({ data: null, error: null }),
);
const tableWrites: { table: string; op: string }[] = [];

vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ userId: USER, organizationId: ORG }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (stateCookie ? { value: stateCookie } : undefined),
    delete: () => undefined,
  }),
}));
vi.mock("@/features/inbox/services/gmail-sync", () => ({
  fetchCalendarOverlay: async () => ({ rows: [], syncToken: "sync-1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const chain = (table: string, op: string) => {
      tableWrites.push({ table, op });
      const result = table === "integration_connection" && op === "upsert"
        ? { data: { id: CONNECTION }, error: null }
        : { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "single", "maybeSingle"]) builder[m] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return builder;
    };
    return {
      rpc,
      from: (table: string) => ({
        upsert: () => chain(table, "upsert"),
        update: () => chain(table, "update"),
        delete: () => chain(table, "delete"),
        select: () => chain(table, "select"),
      }),
    };
  },
}));

const { GET } = await import("@/app/api/integrations/google/callback/route");

function callback(query: string) {
  return new Request(`http://localhost:3000/api/integrations/google/callback?${query}`, {
    headers: { host: "hub.example.org", "x-forwarded-proto": "https" },
  });
}

beforeEach(() => {
  rpc.mockClear();
  tableWrites.length = 0;
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://hub.example.org/api/integrations/google/callback";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }))));
});
afterEach(() => vi.unstubAllGlobals());

describe("Google OAuth callback", () => {
  it("sends a failed connection back to the Hub's own address, not the server's", async () => {
    stateCookie = undefined;
    const res = await GET(callback("code=x&state=y"));
    expect(res.headers.get("location")).toMatch(/^https:\/\/hub\.example\.org\/inbox\?google_error=/);
  });

  it("stores the tokens through the database function and returns to the Hub's address", async () => {
    stateCookie = `google_calendar:${USER}:nonce`;
    const res = await GET(callback(`code=x&state=${encodeURIComponent(stateCookie)}`));
    expect(res.headers.get("location")).toBe("https://hub.example.org/calendar");
    // Sealed before it leaves the server (PRIV-011).
    expect(rpc).toHaveBeenCalledWith("store_integration_tokens", {
      p_connection: CONNECTION,
      p_access: expect.stringMatching(/^enc:v1:/),
      p_refresh: null,
      p_expires: expect.any(String),
    });
    const stored = rpc.mock.calls.find((c: unknown[]) => c[0] === "store_integration_tokens")![1] as { p_access: string };
    expect(openToken(stored.p_access, CONNECTION)).toBe("at");
    expect(rpc).toHaveBeenCalledWith("store_integration_sync_state", {
      p_connection: CONNECTION,
      p_state: { google_calendar_sync_token: "sync-1" },
    });
    // Nothing is written to the token table with the person's session.
    expect(tableWrites.filter((w) => w.table === "integration_secret")).toEqual([]);
  });
});
