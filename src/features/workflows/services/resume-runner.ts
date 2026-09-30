import { isEnabled } from "@/lib/feature-flags";
import type { JobContext, JobResult } from "@/features/jobs/services/runner";
import { resumeWaitingRun, WAITING_RUN_COLUMNS, type WaitingRunRow } from "./run";

/**
 * The `workflow-resume` job (V1-12): continues waiting runs whose resume time
 * has passed (a retry's backoff, a wait). Stopped or switched-off workflows
 * stop their waiting runs instead.
 */
export async function workflowResume({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!(await isEnabled("wos_workflows_v2", db))) {
    return { processed: 0, failed: 0, metadata: { skipped: "wos_workflows_v2 is off" } };
  }
  const { data, error } = await db
    .from("workflow_execution")
    .select(WAITING_RUN_COLUMNS)
    .eq("outcome", "waiting")
    .eq("engine", "graph_v2")
    .not("resume_at", "is", null)
    .lte("resume_at", now.toISOString())
    .order("resume_at", { ascending: true })
    .limit(definition.batch_size);
  if (error) throw new Error(`could not load waiting runs: ${error.message}`);

  let processed = 0;
  let stopped = 0;
  for (const row of (data ?? []) as WaitingRunRow[]) {
    const outcome = await resumeWaitingRun(db, row);
    if (outcome === "resumed") processed += 1;
    if (outcome === "stopped") stopped += 1;
  }

  // The stop switch also ends runs waiting on something with no time set.
  const { data: stoppedRules } = await db
    .from("workflow_rule")
    .select("id")
    .eq("engine", "graph_v2")
    .or("stopped_at.not.is.null,enabled.eq.false");
  const ids = ((stoppedRules ?? []) as { id: string }[]).map((rule) => rule.id);
  if (ids.length > 0) {
    const { data: ended } = await db
      .from("workflow_execution")
      .update({
        outcome: "stopped",
        finished_at: now.toISOString(),
        detail: "stopped: the workflow was stopped or switched off.",
        resume_at: null,
      })
      .eq("outcome", "waiting")
      .in("rule_id", ids)
      .select("id");
    stopped += (ended ?? []).length;
  }
  return { processed, failed: 0, metadata: { stopped } };
}
