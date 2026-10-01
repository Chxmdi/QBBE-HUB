import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanFormFiles } from "@/features/jobs/services/handlers/scan-form-files";
import { scanDocumentBytes } from "@/features/documents/services/clamav";
import { FakeSupabase, asClient } from "../support/fake-supabase";

vi.mock("@/features/documents/services/clamav", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/documents/services/clamav")>()),
  scanDocumentBytes: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const BYTES = "%PDF-1.4 agreement";

function fixture() {
  vi.stubEnv("CLAMAV_SOCKET", "/private/scanner.sock");
  const db = new FakeSupabase();
  db.seed("form_file", [{ id: "file-1", storage_path: "org/u/a/photo.png", scan_status: "pending", scan_attempted_at: null }]);
  db.seed("signing_document", [{ id: "doc-1", storage_path: "org/u/b/agreement.pdf", scan_status: "pending", scan_attempted_at: null }]);
  const buckets: string[] = [];
  const download = vi.fn().mockImplementation(async () => ({ data: new Blob([BYTES]), error: null }));
  const client = Object.assign(asClient(db), {
    storage: { from: (bucket: string) => { buckets.push(bucket); return { download }; } },
  });
  return { db, download, buckets, context: { db: client, now: db.now(), definition: {
    name: "scan-form-files", description: "test", enabled: true, schedule: "* * * * *",
    queue: null, batch_size: 2, max_attempts: 3,
  } } };
}

describe("form file and signing document quarantine worker", () => {
  it("scans both kinds from their own buckets and records each file's SHA-256", async () => {
    const { db, buckets, context } = fixture();
    vi.mocked(scanDocumentBytes).mockResolvedValue("clean");
    expect(await scanFormFiles(context)).toEqual({ processed: 2, failed: 0 });
    expect(buckets).toEqual(["form-files", "signing-documents"]);
    const expected = createHash("sha256").update(BYTES).digest("hex");
    for (const table of ["form_file", "signing_document"]) {
      expect(db.rows(table)[0].scan_status).toBe("clean");
      expect(db.rows(table)[0].content_sha256).toBe(expected);
    }
  });

  it("persists a quarantined verdict", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockResolvedValue("quarantined");
    await scanFormFiles(context);
    expect(db.rows("signing_document")[0].scan_status).toBe("quarantined");
    expect(db.rows("signing_document")[0].quarantined_at).not.toBeNull();
  });

  it("leaves files pending on scanner failure", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockRejectedValue(new Error("scanner unavailable"));
    expect((await scanFormFiles(context)).failed).toBe(2);
    expect(db.rows("form_file")[0].scan_status).toBe("pending");
    expect(db.rows("signing_document")[0].content_sha256).toBeUndefined();
  });

  it("does not scan a failed download", async () => {
    const { db, context, download } = fixture();
    download.mockResolvedValue({ data: null, error: new Error("storage unavailable") });
    expect((await scanFormFiles(context)).failed).toBe(2);
    expect(scanDocumentBytes).not.toHaveBeenCalled();
    expect(db.rows("form_file")[0].scan_status).toBe("pending");
  });

  it("fails visibly when no scanner is configured", async () => {
    const { context } = fixture();
    vi.stubEnv("CLAMAV_SOCKET", "");
    await expect(scanFormFiles(context)).rejects.toThrow("CLAMAV_SOCKET");
  });
});
