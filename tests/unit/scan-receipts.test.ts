import { afterEach, describe, expect, it, vi } from "vitest";
import { scanReceipts } from "@/features/jobs/services/handlers/scan-receipts";
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
  db.seed("finance_receipt", [{ id: "rcpt-1", storage_path: "upload/file", scan_status: "pending" }]);
  const download = vi.fn().mockResolvedValue({ data: new Blob(["file contents"]), error: null });
  const client = Object.assign(asClient(db), { storage: { from: () => ({ download }) } });
  return { db, download, context: { db: client, now: db.now(), definition: {
    name: "scan-receipts", description: "test", enabled: true, schedule: "* * * * *",
    queue: null, batch_size: 2, max_attempts: 3,
  } } };
}
describe("receipt quarantine worker", () => {
  for (const verdict of ["clean", "quarantined"] as const) {
    it(`persists an explicit ${verdict} verdict`, async () => {
      const { db, context } = fixture();
      vi.mocked(scanDocumentBytes).mockResolvedValue(verdict);
      expect((await scanReceipts(context)).processed).toBe(1);
      expect(db.rows("finance_receipt")[0].scan_status).toBe(verdict);
    });
  }
  it("leaves files pending on scanner failure", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockRejectedValue(new Error("scanner unavailable"));
    expect((await scanReceipts(context)).failed).toBe(1);
    expect(db.rows("finance_receipt")[0].scan_status).toBe("pending");
  });
  it("does not scan a failed download", async () => {
    const { db, context, download } = fixture();
    download.mockResolvedValue({ data: null, error: new Error("storage unavailable") });
    expect((await scanReceipts(context)).failed).toBe(1);
    expect(scanDocumentBytes).not.toHaveBeenCalled();
    expect(db.rows("finance_receipt")[0].scan_status).toBe("pending");
  });
  it("reports a failed verdict write and retains quarantine", async () => {
    const { db, context } = fixture();
    vi.mocked(scanDocumentBytes).mockResolvedValue("clean");
    db.fail((op) => op.name === "finance_receipt" && op.kind === "update" && op.args.scan_status === "clean");
    expect((await scanReceipts(context)).failed).toBe(1);
    expect(db.rows("finance_receipt")[0].scan_status).toBe("pending");
  });
  it("fails visibly when no scanner is configured", async () => {
    const { context } = fixture();
    vi.stubEnv("CLAMAV_SOCKET", "");
    await expect(scanReceipts(context)).rejects.toThrow("CLAMAV_SOCKET");
  });
});
