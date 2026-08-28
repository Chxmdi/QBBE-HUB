import type { JobContext, JobResult } from "../runner";
import {
  buildExport,
  serializeExport,
} from "@/features/exports/services/export-builders";

/**
 * Builds queued data exports.
 *
 * Claiming is the only subtle part. Two overlapping runs must not build the
 * same export twice, and there is no lock: the update that moves a row from
 * `queued` to `running` is itself the claim, and its `.eq("status", "queued")`
 * means the second run's update matches nothing. A row that comes back empty
 * was taken by somebody else, so this run simply moves on.
 *
 * A run that dies mid-build leaves a row stuck in `running`. Rather than a
 * separate reaper, anything running for longer than the timeout below is
 * treated as abandoned and put back — the same reasoning the job runner uses
 * for its own abandoned runs.
 */

const ABANDONED_AFTER_MINUTES = 30;

interface ExportRow {
  id: string;
  organization_id: string;
  kind: string;
  subject_user_id: string | null;
  params: Record<string, unknown>;
  requested_by: string;
}

export async function runExports({ db, definition, now }: JobContext): Promise<JobResult> {
  // Put back anything a killed process left behind, before claiming more.
  const abandonedBefore = new Date(
    now.getTime() - ABANDONED_AFTER_MINUTES * 60_000,
  ).toISOString();
  await db
    .from("export_job")
    .update({ status: "queued", started_at: null })
    .eq("status", "running")
    .lt("started_at", abandonedBefore);

  const { data: queued, error } = await db
    .from("export_job")
    .select("id, organization_id, kind, subject_user_id, params, requested_by")
    .eq("status", "queued")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(definition.batch_size);

  if (error) throw new Error(`could not read the export queue: ${error.message}`);

  let processed = 0;
  let failed = 0;

  for (const row of (queued ?? []) as ExportRow[]) {
    // The claim. An empty result means another run got there first.
    const { data: claimed } = await db
      .from("export_job")
      .update({ status: "running", started_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");

    if (!claimed || claimed.length === 0) continue;

    try {
      const built = await buildExport(db, row.kind, {
        organizationId: row.organization_id,
        subjectUserId: row.subject_user_id,
        params: row.params ?? {},
      });

      const body = serializeExport(built, {
        kind: row.kind,
        organization_id: row.organization_id,
        subject_user_id: row.subject_user_id,
        generated_at: now.toISOString(),
        rows: built.rowCount,
      });

      // Scoped by organization so a misconfigured bucket policy still cannot
      // let one organization list another's files.
      const path = `${row.organization_id}/${row.id}.json`;
      const bytes = new TextEncoder().encode(body);

      const { error: uploadError } = await db.storage
        .from("exports")
        .upload(path, bytes, {
          contentType: "application/json",
          upsert: true,
        });

      if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

      await db
        .from("export_job")
        .update({
          status: "ready",
          storage_path: path,
          byte_size: bytes.byteLength,
          row_count: built.rowCount,
          completed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", row.id);

      processed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db
        .from("export_job")
        .update({
          status: "failed",
          error: message.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return { processed, failed, metadata: { claimed: processed + failed } };
}
