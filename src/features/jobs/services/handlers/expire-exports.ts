import type { JobContext, JobResult } from "../runner";

/**
 * Expires exports past their date, and deletes the files behind them.
 *
 * The row survives, the file does not. That asymmetry is the point: an
 * administrator asked afterwards "was a copy of the volunteer database ever
 * taken, by whom, and was it downloaded" needs the record to still exist,
 * while the copy itself should have stopped existing a week after it was made.
 *
 * The file is deleted first. If the delete succeeds and the status update then
 * fails, the next run finds the row still marked ready, tries to delete an
 * object that is already gone, and Storage treats that as success — so the
 * pass is idempotent. Doing it the other way round would leave a file nobody
 * ever looks for again.
 */

interface ExpiringRow {
  id: string;
  storage_path: string | null;
}

export async function expireExports({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: expiring, error } = await db
    .from("export_job")
    .select("id, storage_path")
    .eq("status", "ready")
    .lt("expires_at", now.toISOString())
    .limit(definition.batch_size);

  if (error) throw new Error(`could not read expiring exports: ${error.message}`);

  const rows = (expiring ?? []) as ExpiringRow[];
  if (rows.length === 0) return { processed: 0, failed: 0 };

  const paths = rows.map((row) => row.storage_path).filter((p): p is string => Boolean(p));

  let failed = 0;
  if (paths.length > 0) {
    const { error: removeError } = await db.storage.from("exports").remove(paths);
    if (removeError) {
      // Leave the rows as they are: still ready, still expired, retried next
      // pass. Marking them expired now would strand files nothing points at.
      throw new Error(`could not delete export files: ${removeError.message}`);
    }
  }

  const { error: updateError } = await db
    .from("export_job")
    .update({
      status: "expired",
      storage_path: null,
      completed_at: new Date().toISOString(),
    })
    .in("id", rows.map((row) => row.id));

  if (updateError) {
    failed = rows.length;
    throw new Error(`files deleted but rows not marked: ${updateError.message}`);
  }

  return {
    processed: rows.length,
    failed,
    metadata: { files_deleted: paths.length },
  };
}
