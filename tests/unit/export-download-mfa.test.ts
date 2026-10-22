import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-003: an administrator signed in with only a password must finish
 * two-step verification before an export is handed over, and nothing may be
 * counted, audited or signed before that. Staff are not asked for it.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const EXPORT = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";

let session = { userId: ME, organizationId: ORG, isAdmin: true };
let authorization: { ok: true } | { ok: false; error: string; reason: "role" | "mfa" | "unavailable" } = { ok: true };
const serviceCalls: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => session,
  authorizeAdminAction: async () => (authorization.ok ? { ok: true, session } : authorization),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: {
            id: EXPORT,
            status: "ready",
            storage_path: `${ORG}/${EXPORT}.json`,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            organization_id: ORG,
          },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (name: string) => { serviceCalls.push(`rpc:${name}`); return { error: null }; },
    from: (table: string) => ({ insert: async () => { serviceCalls.push(`insert:${table}`); return { error: null }; } }),
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          serviceCalls.push("sign");
          return { data: { signedUrl: "https://storage.invalid/signed" }, error: null };
        },
      }),
    },
  }),
}));

const { GET } = await import("@/app/api/exports/[id]/download/route");
const call = () => GET(new Request(`http://hub.test/api/exports/${EXPORT}/download`), { params: Promise.resolve({ id: EXPORT }) });

beforeEach(() => {
  serviceCalls.length = 0;
  session = { userId: ME, organizationId: ORG, isAdmin: true };
  authorization = { ok: true };
});

describe("export download and two-step verification (SEC-003)", () => {
  it("sends an admin without two-step verification to /mfa, and counts nothing", async () => {
    authorization = { ok: false, error: "MFA required", reason: "mfa" };
    await expect(call()).rejects.toMatchObject({ to: "/mfa?next=%2Fadmin%2Fexports" });
    expect(serviceCalls).toEqual([]);
  });

  it("refuses when two-step status cannot be read, and counts nothing", async () => {
    authorization = { ok: false, error: "unavailable", reason: "unavailable" };
    const response = await call();
    expect(response.status).toBe(503);
    expect(serviceCalls).toEqual([]);
  });

  it("hands an admin at aal2 the file", async () => {
    const response = await call();
    expect(response.status).toBe(302);
    expect(serviceCalls).toEqual(["rpc:count_export_download", "insert:audit_event", "sign"]);
  });

  it("does not ask staff for two-step verification", async () => {
    session = { userId: ME, organizationId: ORG, isAdmin: false };
    authorization = { ok: false, error: "role", reason: "role" };
    const response = await call();
    expect(response.status).toBe(302);
  });
});
