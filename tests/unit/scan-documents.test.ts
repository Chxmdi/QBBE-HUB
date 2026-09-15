import { afterEach, describe, expect, it, vi } from "vitest";
import { scanDocuments } from "@/features/jobs/services/handlers/scan-documents";
import { scanDocumentBytes } from "@/features/documents/services/clamav";
import { FakeSupabase, asClient } from "../support/fake-supabase";
vi.mock("@/features/documents/services/clamav", () => ({
  MAX_DOCUMENT_BYTES: 25 * 1024 * 1024,
  scanDocumentBytes: vi.fn(),
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
function fixture() {
  vi.stubEnv("CLAMAV_SOCKET", "/private/scanner.sock");
  const db = new FakeSupabase();
  db.seed("document", [{ id: "doc-1", kind: "file", storage_path: "upload/file", scan_status: "pending", archived_at: null }]);
  const download = vi.fn().mockResolvedValue({ data: new Blob(["file contents"]), error: null });
  const client = Object.assign(asClient(db), { storage: { from: () => ({ download }) } });
  return { db, download, context: { db: client, now: db.now(), definition: {
    name: "scan-documents", description: "test", enabled: true, schedule: "* * * * *",
    queue: null, batch_size: 2, max_attempts: 3,
  } } };
}
describe("document quarantine worker", () => {
  for (const verdict of ["clean", "quarantined"] as const) {
    it(`persists an explicit ${verdict} verdict`, async () => {
      const { db, context } = fixture();
      vi.mocked(scanDocumentBytes).mockResolvedValue(verdict);
      expect((await scanDocuments(context)).processed).toBe(1);
      expect(db.rows("document")[0].scan_status).toBe(verdict);
    });
  }
  it("leaves files pending on scanner failure", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockRejectedValue(new Error("scanner unavailable"));
    expect((await scanDocuments(context)).failed).toBe(1);
    expect(db.rows("document")[0].scan_status).toBe("pending");
  });
  it("does not scan a failed download", async () => {
    const { db, context, download } = fixture();
    download.mockResolvedValue({ data: null, error: new Error("storage unavailable") });
    expect((await scanDocuments(context)).failed).toBe(1);
    expect(scanDocumentBytes).not.toHaveBeenCalled();
    expect(db.rows("document")[0].scan_status).toBe("pending");
  });
  it("reports a failed verdict write and retains quarantine", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockResolvedValue("clean");
    db.fail((op) => op.name === "document" && op.kind === "update" && op.args.scan_status === "clean");
    expect((await scanDocuments(context)).failed).toBe(1);
    expect(db.rows("document")[0].scan_status).toBe("pending");
  });
  it("fails visibly when no scanner is configured", async () => {
    const { context } = fixture();
    vi.stubEnv("CLAMAV_SOCKET", "");
    await expect(scanDocuments(context)).rejects.toThrow("CLAMAV_SOCKET");
  });
});
