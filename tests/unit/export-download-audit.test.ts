import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A data export is handed over only once the record of who took it is
 * stored: when the audit write fails, no signed link is made and the route
 * answers with the shared refusal (recordAudit / auditUnavailableResponse).
 */

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  auditError: null as { message: string } | null,
  audited: [] as Record<string, unknown>[],
  signed: 0,
}));

vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ userId: "u-1", organizationId: ORG, isAdmin: false }),
  authorizeAdminAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/server-log", () => ({ logEvent: vi.fn(), logActionFailure: vi.fn(), requestIdOf: () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: ID,
              status: "ready",
              storage_path: `${ORG}/${ID}.json`,
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
              organization_id: ORG,
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_event") state.audited.push(row);
        return { error: state.auditError };
      },
    }),
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          state.signed += 1;
          return { data: { signedUrl: "http://127.0.0.1:54321/signed" }, error: null };
        },
      }),
    },
  }),
}));

const { GET } = await import("@/app/api/exports/[id]/download/route");
const call = () => GET(new Request(`http://localhost/api/exports/${ID}/download`), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  state.auditError = null;
  state.audited = [];
  state.signed = 0;
});

describe("export download", () => {
  it("makes no link and answers with the shared refusal when the audit write fails", async () => {
    state.auditError = { message: "audit_event is unavailable" };
    const response = await call();
    expect(response.status).toBe(503);
    const { createTranslator } = await import("@/lib/i18n/translate");
    expect(await response.text()).toBe(createTranslator("en")("errors.auditUnavailable"));
    expect(state.signed).toBe(0);
  });

  it("records who took which export, then hands over a short-lived link", async () => {
    const response = await call();
    expect(state.audited).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        actor_id: "u-1",
        event_type: "data_export",
        action: "export_downloaded",
        object_type: "export_job",
        object_id: ID,
      }),
    ]);
    expect(response.status).toBe(302);
    expect(state.signed).toBe(1);
  });
});
