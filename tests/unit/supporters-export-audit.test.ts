import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The supporters export is audited inside public.zeffy_supporter_totals: a
 * failed audit write aborts the call. The route must then answer with an
 * error, never a CSV.
 */

const state = vi.hoisted(() => ({ error: null as { code?: string; message: string } | null }));

vi.mock("@/lib/auth", () => ({
  requireStaff: async () => ({ organizationId: "org-1", userId: "u-1" }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async () => ({ data: state.error ? null : [], error: state.error }),
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  }),
}));

const { GET } = await import("@/app/api/crm/supporters/export/route");

beforeEach(() => {
  state.error = null;
});

describe("supporters export", () => {
  it("hands over no CSV when the audited read fails", async () => {
    state.error = { code: "P0001", message: "could not record the export" };
    const response = await GET();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("content-type") ?? "").not.toContain("text/csv");
  });

  it("answers 403 when the person may not read the ledger", async () => {
    state.error = { code: "42501", message: "denied" };
    const response = await GET();
    expect(response.status).toBe(403);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("serves the CSV when the audited read succeeds", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("supporters-giving-");
  });
});
