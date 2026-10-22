import { beforeEach, describe, expect, it, vi } from "vitest";

/** Admin > Jobs: sending this organization's failed email again. */

const ORG = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  authorized: true,
  calls: [] as { name: string; args: unknown }[],
  result: { data: 3 as number | null, error: null as { message: string } | null },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  authorizeAdminAction: async () =>
    state.authorized
      ? { ok: true, session: { userId: "u", organizationId: ORG, isAdmin: true, role: "admin" } }
      : { ok: false, error: "Administrators only.", reason: "role" },
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: unknown) => (state.calls.push({ name, args }), state.result),
  }),
}));

const { requeueFailedEmails } = await import("@/features/jobs/services/jobs.commands");

beforeEach(() => {
  state.authorized = true;
  state.calls = [];
  state.result = { data: 3, error: null };
});

describe("requeueFailedEmails", () => {
  it("re-queues the administrator's own organization's failed email and says how many", async () => {
    const result = await requeueFailedEmails();
    expect(state.calls).toEqual([{ name: "requeue_failed_email_deliveries", args: { p_organization: ORG } }]);
    expect(result).toEqual({ ok: true, count: 3 });
  });

  it("does nothing for someone who is not an administrator", async () => {
    state.authorized = false;
    expect(await requeueFailedEmails()).toEqual({ ok: false, error: "Administrators only." });
    expect(state.calls).toEqual([]);
  });

  it("reports a database refusal in the person's language, without the raw error", async () => {
    state.result = { data: null, error: { message: "permission denied for function" } };
    const result = await requeueFailedEmails();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });
});
