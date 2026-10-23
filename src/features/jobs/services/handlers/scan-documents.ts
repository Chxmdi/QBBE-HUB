import { SCANNER_REQUIREMENT, isScannerConfigured } from "@/features/documents/services/clamav";
import { auditQuarantine, scanVerdict } from "./scan-verdict";
import type { JobContext, JobResult } from "../runner";

export async function scanDocuments({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!isScannerConfigured()) throw new Error(`Document scanning requires ${SCANNER_REQUIREMENT}`);
  const { data: documents, error } = await db.from("document")
    .select("id, organization_id, storage_path")
    .eq("kind", "file").eq("scan_status", "pending").is("archived_at", null)
    .order("scan_attempted_at", { ascending: true, nullsFirst: true })
    // Files never tried all lack an attempt time: break the tie by id so the order is stable.
    .order("id", { ascending: true })
    .limit(Math.min(definition.batch_size, 2));
  if (error) throw new Error("Could not load files awaiting scanning");
  let processed = 0;
  let failed = 0;
  let quarantined = 0;
  for (const document of documents ?? []) {
    try {
      const { error: attemptError } = await db.from("document")
        .update({ scan_attempted_at: now.toISOString() }).eq("id", document.id);
      if (attemptError) throw new Error("Could not record scan attempt");
      const { data: file, error: downloadError } = await db.storage.from("documents").download(document.storage_path);
      if (downloadError || !file) throw new Error("Could not read file for scanning");
      const verdict = await scanVerdict(file);
      const { error: saveError } = await db.from("document").update({
        scan_status: verdict.status,
        scan_note: verdict.note,
        quarantined_at: verdict.status === "clean" ? null : now.toISOString(),
      }).eq("id", document.id).eq("storage_path", document.storage_path).eq("scan_status", "pending");
      if (saveError) throw new Error("Could not save scan verdict");
      await auditQuarantine(db, verdict, { organizationId: document.organization_id, objectType: "document", objectId: document.id });
      if (verdict.status !== "clean") quarantined += 1;
      processed += 1;
    } catch {
      failed += 1;
      // A later sweep retries. Never turn scanner outages into clean verdicts.
    }
  }
  return { processed, failed, metadata: { quarantined } };
}
