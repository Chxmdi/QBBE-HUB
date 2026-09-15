import { MAX_DOCUMENT_BYTES, scanDocumentBytes } from "@/features/documents/services/clamav";
import type { JobContext, JobResult } from "../runner";

export async function scanDocuments({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!process.env.CLAMAV_SOCKET) throw new Error("Document scanning requires CLAMAV_SOCKET");
  const { data: documents, error } = await db.from("document")
    .select("id, storage_path")
    .eq("kind", "file").eq("scan_status", "pending").is("archived_at", null)
    .order("scan_attempted_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(definition.batch_size, 2));
  if (error) throw new Error("Could not load files awaiting scanning");
  let processed = 0;
  let failed = 0;
  for (const document of documents ?? []) {
    try {
      const { error: attemptError } = await db.from("document")
        .update({ scan_attempted_at: now.toISOString() }).eq("id", document.id);
      if (attemptError) throw new Error("Could not record scan attempt");
      const { data: file, error: downloadError } = await db.storage.from("documents").download(document.storage_path);
      if (downloadError || !file) throw new Error("Could not read file for scanning");
      const verdict = file.size > MAX_DOCUMENT_BYTES ? "rejected"
        : await scanDocumentBytes(new Uint8Array(await file.arrayBuffer()));
      const { error: saveError } = await db.from("document").update({
        scan_status: verdict,
        scan_note: verdict === "rejected" ? "File exceeds 25 MB" : "ClamAV scan completed",
        quarantined_at: verdict === "clean" ? null : now.toISOString(),
      }).eq("id", document.id).eq("storage_path", document.storage_path).eq("scan_status", "pending");
      if (saveError) throw new Error("Could not save scan verdict");
      processed += 1;
    } catch {
      failed += 1;
      // A later sweep retries. Never turn scanner outages into clean verdicts.
    }
  }
  return { processed, failed };
}
