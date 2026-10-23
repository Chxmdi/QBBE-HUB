import { SCANNER_REQUIREMENT, isScannerConfigured } from "@/features/documents/services/clamav";
import { auditQuarantine, scanVerdict } from "./scan-verdict";
import type { JobContext, JobResult } from "../runner";

/**
 * Receipt uploads (#142) get the same quarantine as documents: a file is
 * downloadable only after ClamAV has called it clean, and a scanner outage
 * leaves it pending rather than waving it through.
 */
export async function scanReceipts({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!isScannerConfigured()) throw new Error(`Receipt scanning requires ${SCANNER_REQUIREMENT}`);
  const { data: receipts, error } = await db.from("finance_receipt")
    .select("id, organization_id, storage_path")
    .eq("scan_status", "pending")
    .order("scan_attempted_at", { ascending: true, nullsFirst: true })
    .limit(Math.min(definition.batch_size, 2));
  if (error) throw new Error("Could not load receipts awaiting scanning");
  let processed = 0;
  let failed = 0;
  let quarantined = 0;
  for (const receipt of receipts ?? []) {
    try {
      const { error: attemptError } = await db.from("finance_receipt")
        .update({ scan_attempted_at: now.toISOString() }).eq("id", receipt.id);
      if (attemptError) throw new Error("Could not record scan attempt");
      const { data: file, error: downloadError } = await db.storage.from("receipts").download(receipt.storage_path);
      if (downloadError || !file) throw new Error("Could not read receipt for scanning");
      const verdict = await scanVerdict(file);
      const { error: saveError } = await db.from("finance_receipt").update({
        scan_status: verdict.status,
        scan_note: verdict.note,
        quarantined_at: verdict.status === "clean" ? null : now.toISOString(),
      }).eq("id", receipt.id).eq("storage_path", receipt.storage_path).eq("scan_status", "pending");
      if (saveError) throw new Error("Could not save scan verdict");
      await auditQuarantine(db, verdict, { organizationId: receipt.organization_id, objectType: "receipt", objectId: receipt.id });
      if (verdict.status !== "clean") quarantined += 1;
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed, failed, metadata: { quarantined } };
}
