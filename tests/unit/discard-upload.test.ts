import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A failed save or a dismissed capture discards its upload through the
 * server, and only after the database, asked as the signed-in person, says
 * the file is their own and registered nowhere (SEC-016).
 */

let allowed: { data: unknown; error: { message: string } | null };
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<typeof allowed>>(async () => allowed);
const remove = vi.fn<(bucket: string, names: string[]) => Promise<{ data: unknown[]; error: null }>>(async () => ({ data: [], error: null }));
const requireSession = vi.fn(async () => ({ userId: "u1", organizationId: "o1" }));

vi.mock("@/lib/auth", () => ({ requireSession }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ storage: { from: (bucket: string) => ({ remove: (names: string[]) => remove(bucket, names) }) } }),
}));
vi.mock("@/lib/server-log", () => ({ logEvent: vi.fn() }));

const { discardOwnUpload } = await import("@/features/documents/services/discard-upload");

beforeEach(() => {
  vi.clearAllMocks();
  allowed = { data: true, error: null };
});

describe("discarding an upload", () => {
  it("removes the file once the database says it is the person's own and unregistered", async () => {
    await discardOwnUpload("o1/u1/r/file.pdf");
    expect(requireSession).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("document_upload_discardable", { p_name: "o1/u1/r/file.pdf" });
    expect(remove).toHaveBeenCalledWith("documents", ["o1/u1/r/file.pdf"]);
  });

  it("removes nothing the database does not allow, or when it cannot be asked", async () => {
    allowed = { data: false, error: null };
    await discardOwnUpload("o1/u2/r/theirs.pdf");
    allowed = { data: null, error: { message: "down" } };
    await discardOwnUpload("o1/u1/r/file.pdf");
    expect(remove).not.toHaveBeenCalled();
  });

  it("ignores an empty or oversized path without asking", async () => {
    await discardOwnUpload("");
    await discardOwnUpload("x".repeat(501));
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
