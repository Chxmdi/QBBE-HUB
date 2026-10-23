import { logEvent } from "@/lib/server-log";
import type { JobContext, JobResult } from "../runner";

/**
 * Deletes uploads nobody registered, once 24 hours old (SEC-016).
 *
 * The browser uploads a file first and registers it (a library record, a
 * capture, a receipt, a form answer, a document to sign) second. A closed
 * tab or a failed save leaves the file behind with nothing pointing at it.
 * app.unregistered_uploads lists them; they are removed through the storage
 * API, which deletes the bytes as well as the row. A day's wait leaves any
 * save still in progress alone.
 *
 * A bucket that cannot be cleaned is logged and counted as failed, and the
 * rest still are; its files are listed again next run.
 */

const UPLOAD_BUCKETS = new Set(["documents", "receipts", "form-files", "signing-documents"]);
const AGE_MS = 24 * 60 * 60 * 1000;

export async function purgeUnregisteredUploads({ db, definition, now }: JobContext): Promise<JobResult> {
  const { data, error } = await db.rpc("unregistered_uploads", {
    p_before: new Date(now.getTime() - AGE_MS).toISOString(),
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
  const metadata: Record<string, number> = {};
  for (const [bucket, names] of byBucket) {
    const { error: removeError } = await db.storage.from(bucket).remove(names);
    if (removeError) {
      failed += names.length;
      logEvent("storage.purge_unregistered_failed", { bucket, count: names.length, error: removeError.message }, "error");
      continue;
    }
    processed += names.length;
    metadata[bucket] = names.length;
  }
  return { processed, failed, metadata };
}
