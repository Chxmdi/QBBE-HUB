import type { JobContext, JobResult } from "../runner";
import {
  SUBJECT_HANDLERS,
  cutoffFor,
} from "@/features/retention/services/retention-subjects";

/**
 * Applies every enabled retention policy, and writes down what it did.
 *
 * Three things this deliberately does:
 *
 *   - only enabled policies. A policy is created switched off so that an
 *     administrator can see what it would remove before it removes anything;
 *   - one batch per policy per night. Retention is not urgent, and a pass that
 *     deletes at most `batch_size` rows per policy cannot take a table down
 *     with it if somebody sets a policy far too aggressively;
 *   - a `retention_run` row whatever happens, success or failure. Deletion
 *     without a record of it is indistinguishable from data loss, and the
 *     first question after an unexpected gap is "did retention do this".
 *
 * A policy whose subject has no handler is recorded as a failure rather than
 * skipped, because a rule that silently does nothing is worse than one that
 * visibly breaks: an administrator would believe it was working.
 */

interface PolicyRow {
  id: string;
  organization_id: string;
  subject_key: string;
  retain_days: number;
  action: "delete" | "anonymise";
}

export async function applyRetention({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const { data: policies, error } = await db
    .from("retention_policy")
    .select("id, organization_id, subject_key, retain_days, action")
    .eq("enabled", true)
    .limit(definition.batch_size);

  if (error) throw new Error(`could not read retention policies: ${error.message}`);

  let processed = 0;
  let failed = 0;
  const removed: Record<string, number> = {};

  for (const policy of (policies ?? []) as PolicyRow[]) {
    const cutoff = cutoffFor(policy.retain_days, now);
    const handler = SUBJECT_HANDLERS[policy.subject_key];

    if (!handler) {
      failed += 1;
      await db.from("retention_run").insert({
        organization_id: policy.organization_id,
        policy_id: policy.id,
        subject_key: policy.subject_key,
        action: policy.action,
        cutoff,
        affected: 0,
        error: `No handler is implemented for "${policy.subject_key}".`,
      });
      continue;
    }

    try {
      const affected = await handler.apply(
        db,
        policy.organization_id,
        cutoff,
        policy.action,
        definition.batch_size,
      );

      await db.from("retention_run").insert({
        organization_id: policy.organization_id,
        policy_id: policy.id,
        subject_key: policy.subject_key,
        action: policy.action,
        cutoff,
        affected,
      });

      await db
        .from("retention_policy")
        .update({ last_run_at: now.toISOString(), last_affected: affected })
        .eq("id", policy.id);

      removed[policy.subject_key] = (removed[policy.subject_key] ?? 0) + affected;
      processed += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failed += 1;
      await db.from("retention_run").insert({
        organization_id: policy.organization_id,
        policy_id: policy.id,
        subject_key: policy.subject_key,
        action: policy.action,
        cutoff,
        affected: 0,
        error: message.slice(0, 500),
      });
    }
  }

  return { processed, failed, metadata: { removed } };
}
