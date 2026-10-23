import { createHash } from "node:crypto";
import { SCANNER_REQUIREMENT, isScannerConfigured } from "@/features/documents/services/clamav";
import { auditQuarantine, scanVerdict } from "./scan-verdict";
import type { JobContext, JobResult } from "../runner";

/**
 * Form attachments and documents sent for signature (#145, #144) get the same
 * quarantine as documents: downloadable only once ClamAV calls them clean,
 * and a scanner outage leaves them pending rather than waving them through.
 *
 * This job is also the one trusted reader of the private bytes, so it records
 * each file's SHA-256. A document's hash is what its signatures cover; the
 * database refuses to let it change once written.
 */
const SOURCES = [
  { table: "form_file", bucket: "form-files" },
  { table: "signing_document", bucket: "signing-documents" },
] as const;

export async function scanFormFiles({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!isScannerConfigured()) throw new Error(`Form file scanning requires ${SCANNER_REQUIREMENT}`);
  let processed = 0;
  let failed = 0;
  let quarantined = 0;
  for (const { table, bucket } of SOURCES) {
    const { data: rows, error } = await db.from(table)
      .select("id, organization_id, storage_path")
      .eq("scan_status", "pending")
      .order("scan_attempted_at", { ascending: true, nullsFirst: true })
      .limit(Math.min(definition.batch_size, 2));
    if (error) throw new Error(`Could not load ${table} rows awaiting scanning`);
    for (const row of rows ?? []) {
      try {
        const { error: attemptError } = await db.from(table)
          .update({ scan_attempted_at: now.toISOString() }).eq("id", row.id);
        if (attemptError) throw new Error("Could not record scan attempt");
        const { data: file, error: downloadError } = await db.storage.from(bucket).download(row.storage_path);
        if (downloadError || !file) throw new Error("Could not read file for scanning");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const verdict = await scanVerdict(bytes);
        const { data: saved, error: saveError } = await db.from(table).update({
          scan_status: verdict.status,
          scan_note: verdict.note,
          quarantined_at: verdict.status === "clean" ? null : now.toISOString(),
          content_sha256: createHash("sha256").update(bytes).digest("hex"),
        }).eq("id", row.id).eq("storage_path", row.storage_path).eq("scan_status", "pending").select("id");
        if (saveError) throw new Error("Could not save scan verdict");
        // Only a verdict this run actually saved (another worker may have
        // got there first) is audited and counted.
        if ((saved ?? []).length === 0) continue;
        await auditQuarantine(db, verdict, { organizationId: row.organization_id, objectType: table, objectId: row.id });
        if (verdict.status !== "clean") quarantined += 1;
        processed += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { processed, failed, metadata: { quarantined } };
}
