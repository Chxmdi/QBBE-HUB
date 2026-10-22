import { beforeEach, describe, expect, it, vi } from "vitest";
import { withActiveOwners } from "@/features/jobs/services/active-owners";
import { FakeSupabase, asClient } from "./../support/fake-supabase";

/** Google sync jobs skip connections whose owner left the organization. */
describe("withActiveOwners", () => {
  it("drops a connection whose owner is no longer an active member", async () => {
    const db = new FakeSupabase();
    db.seed("organization_membership", [
      { organization_id: "org-1", user_id: "stays", status: "active" },
      { organization_id: "org-1", user_id: "left", status: "deactivated" },
      { organization_id: "org-2", user_id: "left", status: "active" },
    ]);
    const kept = await withActiveOwners(asClient(db), [
      { id: "a", organization_id: "org-1", user_id: "stays" },
      { id: "b", organization_id: "org-1", user_id: "left" },
      { id: "c", organization_id: "org-1", user_id: null },
    ]);
    expect(kept.map((connection) => connection.id)).toEqual(["a", "c"]);
  });
});

const ME = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  banError: null as { message: string } | null,
  otherActive: [] as { id: string }[],
  bans: [] as { userId: string; ban: string }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => {
  const session = { userId: ME, organizationId: ORG, isAdmin: true, isStaff: true, role: "owner" };
  return { requireSession: async () => session, authorizeAdminAction: async () => ({ ok: true, session }) };
});
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", async () => {
  const { fakeDb } = await import("@/lib/objects/testing/fake-db");
  return {
    createSupabaseServerClient: async () =>
      fakeDb({
        table: (call) =>
          call.table === "organization_membership" && call.action === "select"
            ? { data: { role: "volunteer", user_id: MEMBER }, error: null }
            : { data: { id: "m-1" }, error: null },
      }).db,
  };
});
vi.mock("@/lib/supabase/service", async () => {
  const { fakeDb } = await import("@/lib/objects/testing/fake-db");
  return {
    createSupabaseServiceClient: () => {
      const { db } = fakeDb({ table: () => ({ data: state.otherActive, error: null }) });
      return Object.assign(db, {
        auth: {
          admin: {
            updateUserById: async (userId: string, attributes: { ban_duration: string }) => {
              state.bans.push({ userId, ban: attributes.ban_duration });
              return { data: null, error: state.banError };
            },
          },
        },
      });
    },
  };
});

const { setMemberActive } = await import("@/features/admin/services/admin.commands");

describe("setMemberActive", () => {
  beforeEach(() => {
    state.banError = null;
    state.otherActive = [];
    state.bans.length = 0;
  });

  it("blocks sign-in when the member has no other active membership, and lifts it on reactivation", async () => {
    expect(await setMemberActive("m-1", false)).toEqual({ ok: true });
    expect(await setMemberActive("m-1", true)).toEqual({ ok: true });
    expect(state.bans).toEqual([
      { userId: MEMBER, ban: "876000h" },
      { userId: MEMBER, ban: "none" },
    ]);
  });

  it("does not block a person still active in another organization", async () => {
    state.otherActive = [{ id: "elsewhere" }];
    expect(await setMemberActive("m-1", false)).toEqual({ ok: true });
    expect(state.bans).toEqual([]);
  });

  it("tells the administrator when sign-in could not be blocked", async () => {
    state.banError = { message: "Auth is unavailable" };
    const result = await setMemberActive("m-1", false);
    expect(result.ok).toBe(false);
    expect((result as { error?: string }).error).toMatch(/could not be blocked/);
  });
});
