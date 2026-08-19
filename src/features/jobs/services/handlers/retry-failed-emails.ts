import { backoffSeconds, enqueue } from "../queue";
import type { JobContext, JobResult } from "../runner";

/**
 * Closes the gaps the happy path cannot.
 *
 * Three of them, each a real way mail goes missing:
 *
 *   1. A run was killed between claiming a delivery and sending it. The row
 *      sits in `sending` with no queue message behind it.
 *   2. A delivery was held for quiet hours and the re-queue never landed —
 *      the row is `queued` with `scheduled_for` in the past.
 *   3. The enqueue trigger could not reach the queue at all, so a notification
 *      exists with no delivery row anywhere.
 *
 * Everything it re-queues is keyed on the same `dedupe_key`, so recovering a
 * delivery that in fact succeeded produces no second email.
 */

const STUCK_MINUTES = 10;

interface StuckRow {
  id: string;
  attempt: number;
  status: string;
}

export async function retryFailedEmails({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const stuckBefore = new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString();
  let requeued = 0;
  let abandoned = 0;

  // 1 + 2: ledger rows that should be moving and are not.
  const { data: stuckRows, error: stuckError } = await db
    .from("email_delivery")
    .select("id, attempt, status")
    .in("status", ["sending", "queued"])
    .lt("updated_at", stuckBefore)
    .order("updated_at", { ascending: true })
    .limit(definition.batch_size);

  if (stuckError) {
    throw new Error(`could not scan for stuck deliveries: ${stuckError.message}`);
  }

  for (const row of (stuckRows ?? []) as StuckRow[]) {
    if (row.attempt >= definition.max_attempts) {
      // Out of attempts. Mark it failed so it stops being swept and starts
      // being visible as a problem.
      await db
        .from("email_delivery")
        .update({
          status: "failed",
          last_error: `Gave up after ${row.attempt} attempts.`,
        })
        .eq("id", row.id);
      abandoned += 1;
      continue;
    }

    await enqueue(
      db,
      "notifications",
      { kind: "retry", delivery_id: row.id },
      backoffSeconds(row.attempt + 1),
    );
    requeued += 1;
  }

  // 3: notifications that never got a delivery row at all.
  const { data: orphans, error: orphanError } = await db.rpc(
    "email_orphaned_notifications",
    { p_older_than_minutes: STUCK_MINUTES, p_limit: definition.batch_size },
  );

  if (orphanError) {
    throw new Error(`could not scan for orphaned notifications: ${orphanError.message}`);
  }

  for (const orphan of (orphans ?? []) as { notification_id: string }[]) {
    await enqueue(db, "notifications", {
      kind: "notification",
      notification_id: orphan.notification_id,
    });
    requeued += 1;
  }

  return {
    processed: requeued,
    failed: abandoned,
    metadata: {
      stuck: (stuckRows ?? []).length,
      orphaned: (orphans ?? []).length,
      abandoned,
    },
  };
}
