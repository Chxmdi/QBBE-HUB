import { recordAudit } from "@/lib/audit-write";
import { logEvent } from "@/lib/server-log";
import type { JobContext, JobResult } from "../runner";

/**
 * Deletes uploads nobody registered, once 24 hours old (SEC-016).
 *
 * The browser uploads a file first and registers it (a library record, a
 * capture, a receipt, a form answer, a document to sign) second. A closed
 * tab or a failed save leaves the file behind with nothing pointing at it.
 * public.unregistered_uploads lists them; they are removed through the
 * storage API, which deletes the bytes as well as the row. A day's wait
 * leaves any save still in progress alone.
 *
 * Deleting production files needs the owner's OK. Until an operator turns
 * the purge-unregistered-uploads switch on (public.set_operator_switch; see
 * docs/runbooks/jobs.md), the job only reports, per bucket, how many files
 * it would delete, their total size and the oldest date, and deletes
 * nothing. A switch it cannot read counts as off.
 *
 * A bucket that cannot be cleaned is logged and counted as failed, and the
 * rest still are; its files are listed again next run.
 */

const SWITCH = "purge-unregistered-uploads";
const UPLOAD_BUCKETS = new Set(["documents", "receipts", "form-files", "signing-documents"]);
const AGE_MS = 24 * 60 * 60 * 1000;

async function audited(db: JobContext["db"], action: string, metadata: Record<string, unknown>) {
  const stored = await recordAudit(db, {
    organization_id: null,
    actor_id: null,
    actor_type: "system",
    event_type: "operations",
    action,
    metadata,
  });
  if (!stored) throw new Error(`could not audit ${action}`);
}

export async function purgeUnregisteredUploads({ db, definition, now }: JobContext): Promise<JobResult> {
  const before = new Date(now.getTime() - AGE_MS).toISOString();

  const { data: switchRow, error: switchError } = await db
    .from("operator_switch")
    .select("enabled")
    .eq("name", SWITCH)
    .maybeSingle();
  if (switchError || switchRow?.enabled !== true) {
    const { data: buckets, error } = await db.rpc("unregistered_uploads_summary", { p_before: before });
    if (error) throw new Error(`could not report unregistered uploads: ${error.message}`);
    const report = { mode: "report", buckets: buckets ?? [] };
    logEvent("storage.purge_unregistered_report", { ...report, switch_unreadable: Boolean(switchError) }, "info");
    await audited(db, "unregistered_uploads_reported", report);
    return { processed: 0, failed: 0, metadata: report };
  }

  const { data, error } = await db.rpc("unregistered_uploads", {
    p_before: before,
    p_limit: definition.batch_size,
  });
  if (error) throw new Error(`could not list unregistered uploads: ${error.message}`);

  const byBucket = new Map<string, string[]>();
  for (const row of (data ?? []) as { bucket_id: string; name: string }[]) {
    if (!UPLOAD_BUCKETS.has(row.bucket_id)) continue;
    byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row.name]);
  }

  let processed = 0;
  let failed = 0;
  const deleted: Record<string, number> = {};
  for (const [bucket, names] of byBucket) {
    const { error: removeError } = await db.storage.from(bucket).remove(names);
    if (removeError) {
      failed += names.length;
      logEvent("storage.purge_unregistered_failed", { bucket, count: names.length, error: removeError.message }, "error");
      continue;
    }
    processed += names.length;
    deleted[bucket] = names.length;
  }
  const metadata = { mode: "delete", deleted, failed };
  // Every deleting run is audited, also one that found nothing or failed, so
  // the operator can tell a quiet run from a broken one. The files are gone
  // by now: if this write fails, the run fails and the log line remains.
  await audited(db, "unregistered_uploads_deleted", metadata);
  return { processed, failed, metadata: { mode: "delete", deleted } };
}
