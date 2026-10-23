import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_DOCUMENT_BYTES, scanDocumentBytes, scanNote } from "@/features/documents/services/clamav";
import { recordAudit } from "@/lib/audit-write";

export interface Verdict {
  status: "clean" | "quarantined" | "rejected";
  note: string;
  signature: string | null;
}

/** Scans one file; a file over the limit is rejected without reading it. */
export async function scanVerdict(file: Blob | Uint8Array): Promise<Verdict> {
  const size = file instanceof Uint8Array ? file.byteLength : file.size;
  if (size > MAX_DOCUMENT_BYTES) {
    return { status: "rejected", note: scanNote("rejected"), signature: null };
  }
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const result = await scanDocumentBytes(bytes);
  return { status: result.verdict, note: scanNote(result), signature: result.signature };
}

/**
 * A quarantined or rejected upload is recorded in the audit log, so it is
 * visible to administrators and not only as a badge on the uploader's list.
 * A failed audit write is logged; the verdict itself is already saved.
 */
export async function auditQuarantine(
  db: SupabaseClient,
  verdict: Verdict,
  row: { organizationId: string | null; objectType: string; objectId: string },
): Promise<void> {
  if (verdict.status === "clean") return;
  await recordAudit(db, {
    organization_id: row.organizationId,
    actor_id: null,
    actor_type: "system",
    event_type: "documents",
    action: verdict.status === "rejected" ? "file_rejected" : "file_quarantined",
    object_type: row.objectType,
    object_id: row.objectId,
    metadata: { signature: verdict.signature ?? verdict.note },
  });
}
