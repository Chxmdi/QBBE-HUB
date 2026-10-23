import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: { event: string; fields: Record<string, unknown> }[] = [];
vi.mock("@/lib/server-log", () => ({
  logEvent: (event: string, fields: Record<string, unknown>) => logged.push({ event, fields }),
  logActionFailure: vi.fn(),
}));

const { purgeUnregisteredUploads } = await import("@/features/jobs/services/handlers/purge-unregistered-uploads");
const { JOB_HANDLERS } = await import("@/features/jobs/services/handlers");

/**
 * Uploads nobody registered (a closed tab, a failed save) are deleted from
 * the four upload buckets once 24 hours old (SEC-016), through the storage
 * API so the bytes go too.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
let listed: { bucket_id: string; name: string }[];
let listError: { message: string } | null;
let removeErrors: Record<string, { message: string }>;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let removed: { bucket: string; names: string[] }[];

function db() {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: listError ? null : listed, error: listError };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (names: string[]) => {
          removed.push({ bucket, names });
          return { data: [], error: removeErrors[bucket] ?? null };
        },
      }),
    },
  } as never;
}

const run = () => purgeUnregisteredUploads({ db: db(), definition: { batch_size: 200 } as never, now: NOW });

beforeEach(() => {
  logged.length = 0;
  listError = null;
  removeErrors = {};
  rpcCalls = [];
  removed = [];
  listed = [
    { bucket_id: "documents", name: "org/u1/a/old.pdf" },
    { bucket_id: "documents", name: "org/u2/b/old.pdf" },
    { bucket_id: "receipts", name: "org/u1/r.pdf" },
    { bucket_id: "signing-documents", name: "org/u3/s.pdf" },
  ];
});

describe("the purge-unregistered-uploads job", () => {
  it("is registered", () => {
    expect(JOB_HANDLERS["purge-unregistered-uploads"]).toBe(purgeUnregisteredUploads);
  });

  it("asks only for uploads more than 24 hours old, up to the batch size", async () => {
    await run();
    expect(rpcCalls).toEqual([
      { fn: "unregistered_uploads", args: { p_before: "2026-10-19T12:00:00.000Z", p_limit: 200 } },
    ]);
  });

  it("deletes each bucket's unregistered uploads through the storage API", async () => {
    const result = await run();
    expect(removed).toEqual([
      { bucket: "documents", names: ["org/u1/a/old.pdf", "org/u2/b/old.pdf"] },
      { bucket: "receipts", names: ["org/u1/r.pdf"] },
      { bucket: "signing-documents", names: ["org/u3/s.pdf"] },
    ]);
    expect(result).toEqual({ processed: 4, failed: 0, metadata: { documents: 2, receipts: 1, "signing-documents": 1 } });
  });

  it("does nothing when nothing is unregistered", async () => {
    listed = [];
    expect(await run()).toEqual({ processed: 0, failed: 0, metadata: {} });
    expect(removed).toEqual([]);
  });

  it("keeps going past a bucket it cannot clean, and counts and logs that bucket's files as failed", async () => {
    removeErrors = { documents: { message: "storage unavailable" } };
    const result = await run();
    expect(removed.map((r) => r.bucket)).toEqual(["documents", "receipts", "signing-documents"]);
    expect(result).toMatchObject({ processed: 2, failed: 2 });
    expect(logged.some((l) => l.event === "storage.purge_unregistered_failed" && l.fields.bucket === "documents")).toBe(true);
  });

  it("fails the run when the list cannot be read", async () => {
    listError = { message: "permission denied" };
    await expect(run()).rejects.toThrow(/unregistered uploads/);
    expect(removed).toEqual([]);
  });

  it("never deletes from a bucket outside the four upload buckets", async () => {
    listed = [{ bucket_id: "exports", name: "org/export.zip" }, ...listed];
    await run();
    expect(removed.map((r) => r.bucket)).not.toContain("exports");
  });
});
