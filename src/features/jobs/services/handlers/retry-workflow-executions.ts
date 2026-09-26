import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Replays notification drafts stored on a failed workflow execution.
 *
 * The drafts keep the same dedupe key, so a retry that races a send which
 * actually landed merges into that row instead of mailing twice.
 */
export async function retryWorkflowExecutions({
  db,
  definition,
}: JobContext): Promise<JobResult> {
  const { data, error } = await db
    .from("workflow_execution")
    .select("id, attempt, payload")
    .eq("outcome", "failed")
    .not("payload", "is", null)
    .lt("attempt", definition.max_attempts)
    .order("created_at", { ascending: true })
    .limit(definition.batch_size);

  if (error) {
    throw new Error(`could not load failed workflow executions: ${error.message}`);
  }

  let processed = 0;
  let failed = 0;

  for (const row of data ?? []) {
    const drafts = Array.isArray(row.payload) ? (row.payload as NotificationDraft[]) : [];
    const nextAttempt = (row.attempt as number) + 1;
    try {
      if (drafts.length === 0) throw new Error("No drafts to retry.");
      await createNotifications(db, drafts);
      const { error: updateError } = await db
        .from("workflow_execution")
        .update({
          outcome: "notified",
          attempt: nextAttempt,
          payload: null,
          detail: `Retried on attempt ${nextAttempt}.`,
        })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      processed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Retry failed.";
      await db
        .from("workflow_execution")
        .update({
          outcome: "failed",
          attempt: nextAttempt,
          detail: message.slice(0, 500),
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return { processed, failed };
}
