import { afterEach, describe, expect, it, vi } from "vitest";
import { scanDocuments } from "@/features/jobs/services/handlers/scan-documents";
import { scanDocumentBytes } from "@/features/documents/services/clamav";
import { FakeSupabase, asClient } from "../support/fake-supabase";
vi.mock("@/features/documents/services/clamav", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/documents/services/clamav")>()),
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
      vi.mocked(scanDocumentBytes).mockResolvedValue({ verdict, signature: verdict === "quarantined" ? "Eicar-Test-Signature" : null });
      expect((await scanDocuments(context)).processed).toBe(1);
      expect(db.rows("document")[0].scan_status).toBe(verdict);
    });
  }
  it("records what the scanner found, audits the quarantine and counts it", async () => {
    const { db, context } = fixture();
    db.rows("document")[0].organization_id = "org-1";
    db.seed("audit_event", []);
    vi.mocked(scanDocumentBytes).mockResolvedValue({ verdict: "quarantined", signature: "Heuristics.Encrypted.PDF" });
    const result = await scanDocuments(context);
    expect(db.rows("document")[0].scan_note).toBe("Heuristics.Encrypted.PDF");
    expect(db.rows("audit_event")).toMatchObject([{
      organization_id: "org-1", actor_type: "system", action: "file_quarantined",
      object_type: "document", object_id: "doc-1", metadata: { signature: "Heuristics.Encrypted.PDF" },
    }]);
    expect(result.metadata).toMatchObject({ quarantined: 1 });
  });

  it("audits nothing when another worker saved the verdict first", async () => {
    const { db, context } = fixture();
    db.seed("audit_event", []);
    vi.mocked(scanDocumentBytes).mockImplementation(async () => {
      db.rows("document")[0].scan_status = "clean";
      return { verdict: "quarantined", signature: "Eicar-Test-Signature" };
    });
    const result = await scanDocuments(context);
    expect(db.rows("audit_event")).toEqual([]);
    expect(result.metadata).toMatchObject({ quarantined: 0 });
  });

  it("takes files never tried in a stable order", async () => {
    const { db, context, download } = fixture();
    db.seed("document", [
      { id: "doc-3", kind: "file", storage_path: "upload/3", scan_status: "pending", archived_at: null },
      { id: "doc-0", kind: "file", storage_path: "upload/0", scan_status: "pending", archived_at: null },
      { id: "doc-1", kind: "file", storage_path: "upload/1", scan_status: "pending", archived_at: null },
    ]);
    vi.mocked(scanDocumentBytes).mockResolvedValue({ verdict: "clean", signature: null });
    await scanDocuments(context);
    expect(download.mock.calls.map(([path]) => path)).toEqual(["upload/0", "upload/1"]);
  });
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
    vi.mocked(scanDocumentBytes).mockResolvedValue({ verdict: "clean", signature: null });
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
