import { beforeEach, describe, expect, it, vi } from "vitest";

/** Admin > Jobs: releasing a false positive and deleting a blocked file. */

const state = vi.hoisted(() => ({
  authorized: true,
  rpc: [] as { name: string; args: unknown }[],
  rpcResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
  removed: [] as { bucket: string; paths: string[] }[],
  removeError: null as { message: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  authorizeAdminAction: async () =>
    state.authorized
      ? { ok: true, session: { userId: "u", organizationId: "org", isAdmin: true, role: "admin" } }
      : { ok: false, error: "Administrators only.", reason: "role" },
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args: unknown) => (state.rpc.push({ name, args }), state.rpcResult),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => (state.removed.push({ bucket, paths }), { error: state.removeError }),
      }),
    },
  }),
}));

const { deleteQuarantinedFile, releaseQuarantinedFile } = await import("@/features/documents/services/quarantine.commands");

beforeEach(() => {
  state.authorized = true;
  state.rpc = [];
  state.rpcResult = { data: null, error: null };
  state.removed = [];
  state.removeError = null;
});

describe("releasing a quarantined file", () => {
  it("asks the database to release it with the reason given", async () => {
    expect(await releaseQuarantinedFile({ kind: "document", id: "d1", reason: "Password removed by the sender" })).toEqual({ ok: true });
    expect(state.rpc).toEqual([{ name: "release_quarantined_file", args: { p_kind: "document", p_id: "d1", p_reason: "Password removed by the sender" } }]);
  });

  it("says a virus cannot be released, in the person's language, without the database text", async () => {
    state.rpcResult = { data: null, error: { code: "22023", message: "Only a file quarantined by a heuristic can be released" } };
    const result = await releaseQuarantinedFile({ kind: "document", id: "d1", reason: "x" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/cannot be released/) });
    expect(JSON.stringify(result)).not.toContain("heuristic");
  });

  it("does nothing for someone who is not an administrator, or for an unknown kind", async () => {
    state.authorized = false;
    expect((await releaseQuarantinedFile({ kind: "document", id: "d1", reason: "x" })).ok).toBe(false);
    state.authorized = true;
    expect((await releaseQuarantinedFile({ kind: "elsewhere", id: "d1", reason: "x" })).ok).toBe(false);
    expect(state.rpc).toEqual([]);
  });
});

describe("deleting a quarantined file", () => {
  it("records the deletion, then removes the bytes from the file's bucket", async () => {
    state.rpcResult = { data: [{ bucket: "documents", storage_path: "org/u/x/eicar.txt" }], error: null };
    expect(await deleteQuarantinedFile({ kind: "document", id: "d2" })).toEqual({ ok: true });
    expect(state.rpc[0]).toEqual({ name: "purge_quarantined_file", args: { p_kind: "document", p_id: "d2" } });
    expect(state.removed).toEqual([{ bucket: "documents", paths: ["org/u/x/eicar.txt"] }]);
  });

  it("removes nothing when the database refuses, and says so when the bytes could not be removed", async () => {
    state.rpcResult = { data: null, error: { code: "42501", message: "denied" } };
    expect((await deleteQuarantinedFile({ kind: "document", id: "d2" })).ok).toBe(false);
    expect(state.removed).toEqual([]);

    state.rpcResult = { data: [{ bucket: "documents", storage_path: "p" }], error: null };
    state.removeError = { message: "storage down" };
    const result = await deleteQuarantinedFile({ kind: "document", id: "d2" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/try again/i) });
  });
});
