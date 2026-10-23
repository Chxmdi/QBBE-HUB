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
 * API so the bytes go too, but only once an operator has turned the
 * purge-unregistered-uploads switch on. Until then the job reports what it
 * would delete and deletes nothing.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
let listed: { bucket_id: string; name: string }[];
let listError: { message: string } | null;
let removeErrors: Record<string, { message: string }>;
let rpcCalls: { fn: string; args: Record<string, unknown> }[];
let removed: { bucket: string; names: string[] }[];
let switchRow: { data: { enabled: boolean } | null; error: { message: string } | null };
let summary: { bucket_id: string; files: number; bytes: number; oldest: string }[];
let audits: Record<string, unknown>[];
let auditError: { message: string } | null;

function db() {
  return {
    from: (table: string) => {
      if (table === "audit_event") {
        return {
          insert: async (row: Record<string, unknown>) => {
            audits.push(row);
            return { error: auditError };
          },
        };
      }
      expect(table).toBe("operator_switch");
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            expect([column, value]).toEqual(["name", "purge-unregistered-uploads"]);
            return { maybeSingle: async () => switchRow };
          },
        }),
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "unregistered_uploads_summary") return { data: summary, error: null };
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
  audits = [];
  auditError = null;
  switchRow = { data: { enabled: true }, error: null };
  summary = [
    { bucket_id: "documents", files: 2, bytes: 1500, oldest: "2026-09-01T00:00:00Z" },
    { bucket_id: "receipts", files: 1, bytes: 70, oldest: "2026-10-01T00:00:00Z" },
  ];
  listed = [
    { bucket_id: "documents", name: "org/u1/a/old.pdf" },
    { bucket_id: "documents", name: "org/u2/b/old.pdf" },
    { bucket_id: "receipts", name: "org/u1/r.pdf" },
    { bucket_id: "signing-documents", name: "org/u3/s.pdf" },
  ];
});

describe("the purge-unregistered-uploads job, switch off", () => {
  it("deletes nothing, and reports per bucket what it would delete", async () => {
    switchRow = { data: { enabled: false }, error: null };
    const result = await run();
    expect(removed).toEqual([]);
    expect(rpcCalls).toEqual([
      { fn: "unregistered_uploads_summary", args: { p_before: "2026-10-19T12:00:00.000Z" } },
    ]);
    const report = { mode: "report", buckets: summary };
    expect(result).toEqual({ processed: 0, failed: 0, metadata: report });
    expect(audits).toEqual([
      expect.objectContaining({
        organization_id: null,
        actor_type: "system",
        event_type: "operations",
        action: "unregistered_uploads_reported",
        metadata: report,
      }),
    ]);
    expect(logged.some((l) => l.event === "storage.purge_unregistered_report" && l.fields.mode === "report")).toBe(true);
  });

  it("treats a missing switch, or one it cannot read, as off", async () => {
    switchRow = { data: null, error: null };
    await run();
    switchRow = { data: null, error: { message: "permission denied" } };
    await run();
    expect(removed).toEqual([]);
  });

  it("fails the run when the report cannot be audited", async () => {
    switchRow = { data: { enabled: false }, error: null };
    auditError = { message: "audit unavailable" };
    await expect(run()).rejects.toThrow(/audit/);
    expect(removed).toEqual([]);
  });
});

describe("the purge-unregistered-uploads job, switch on", () => {
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
    const deleted = { mode: "delete", deleted: { documents: 2, receipts: 1, "signing-documents": 1 } };
    expect(result).toEqual({ processed: 4, failed: 0, metadata: deleted });
    expect(audits).toEqual([
      expect.objectContaining({ action: "unregistered_uploads_deleted", metadata: { ...deleted, failed: 0 } }),
    ]);
  });

  it("does nothing when nothing is unregistered", async () => {
    listed = [];
    expect(await run()).toEqual({ processed: 0, failed: 0, metadata: { mode: "delete", deleted: {} } });
    expect(removed).toEqual([]);
    // Audited all the same, so a quiet run is told apart from a broken one.
    expect(audits).toEqual([
      expect.objectContaining({ action: "unregistered_uploads_deleted", metadata: { mode: "delete", deleted: {}, failed: 0 } }),
    ]);
  });

  it("keeps going past a bucket it cannot clean, and counts and logs that bucket's files as failed", async () => {
    removeErrors = { documents: { message: "storage unavailable" } };
    const result = await run();
    expect(removed.map((r) => r.bucket)).toEqual(["documents", "receipts", "signing-documents"]);
    expect(result).toMatchObject({ processed: 2, failed: 2 });
    expect(audits[0]).toMatchObject({ metadata: { failed: 2 } });
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
