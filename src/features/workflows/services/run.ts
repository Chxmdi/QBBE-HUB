import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity, ObjectEvent } from "@/lib/objects/contracts";
import { createEventWriterStub } from "@/lib/objects/stubs";
import { createWorkflowActionRegistry } from "../actions";
import { runGraph, type EnginePorts, type RunResult, type StepRecord } from "../engine";
import type { WorkflowGraph } from "../graph";
import { eventScope } from "../scope";

/**
 * Starts, runs and records one workflow run (M14a/b).
 *
 * Called by the runner job for real events and by the workflow screen for a
 * test run. Always with the service client: runs and their steps are written
 * by the runner only (20261106010001). Permission is not the service role's:
 * every action is checked with app.can_as for the workflow's owner.
 */

export interface GraphRule {
  id: string;
  organization_id: string;
  name: string;
  graph: WorkflowGraph;
  run_as_user_id: string | null;
  created_by: string | null;
}

export interface RunRequest {
  rule: GraphRule;
  event: ObjectEvent;
  /** A test run from the workflow screen: actions are checked, not run. */
  test?: boolean;
  now?: () => Date;
}

export type RunRecord =
  | { status: "recorded"; executionId: string; runNumber: number; result: RunResult }
  | { status: "duplicate" };

const UNIQUE_VIOLATION = "23505";

/** Whose permissions the run acts with. */
export function runAsUser(rule: Pick<GraphRule, "run_as_user_id" | "created_by">): string | null {
  return rule.run_as_user_id ?? rule.created_by;
}

export function createRunPorts(
  db: SupabaseClient,
  rule: GraphRule,
  runId: string,
): EnginePorts {
  const registry = createWorkflowActionRegistry({
    db,
    organizationId: rule.organization_id,
    workflowId: rule.id,
    runId,
  });
  const owner = runAsUser(rule);
  const actor: Identity = { kind: "automation", id: rule.id };
  const context = {
    actor,
    can: async (objectId: string, capability: string) => {
      if (!owner) return false;
      const { data, error } = await db.rpc("can_as", {
        p_user: owner,
        p_object: objectId,
        p_capability: capability,
        // Only an admin in a two-step session can save a workflow; the check
        // falls back to aal1 when the owner has no live second factor.
        p_assurance: "aal2",
      });
      return !error && data === true;
    },
  };
  const writeEvent = createEventWriterStub(db);

  return {
    async runAction(key, input) {
      const result = await registry.run(key, input, context);
      if (result.ok) {
        // One event per changed object, labelled as the automation, so the
        // activity feed says a workflow did it and the runner skips it.
        for (const change of result.changeSet.changes) {
          if (change.kind !== "update") continue;
          await writeEvent({
            object: change.object,
            organizationId: rule.organization_id,
            actor,
            verb: "updated",
            changes: [{ property: change.property, before: change.before, after: change.after }],
            changeSetId: result.changeSet.id,
            summary: `Workflow "${rule.name}" changed ${change.property}.`,
          }).catch((error: unknown) => {
            console.error(JSON.stringify({
              event: "workflow.event_write_failed",
              workflow: rule.id,
              error: error instanceof Error ? error.message : String(error),
            }));
          });
        }
      }
      return result;
    },
    async checkAction(key, input) {
      const action = registry.get(key);
      if (!action) return "unknown_action";
      for (const target of action.targets(input)) {
        if (!(await context.can(target, action.capability))) return "forbidden";
      }
      return "ok";
    },
  };
}

function stepRows(executionId: string, organizationId: string, steps: StepRecord[]) {
  return steps.map((step) => ({
    execution_id: executionId,
    organization_id: organizationId,
    position: step.position,
    step_id: step.stepId,
    step_kind: step.kind,
    status: step.status,
    input: step.input ?? null,
    output: step.output ?? null,
    error: step.error ? step.error.slice(0, 2000) : null,
    attempt: step.attempt,
    started_at: step.startedAt,
    finished_at: step.finishedAt,
  }));
}

export async function executeWorkflowRun(db: SupabaseClient, request: RunRequest): Promise<RunRecord> {
  const { rule, event } = request;
  const now = request.now ?? (() => new Date());
  const { data: created, error: createError } = await db
    .from("workflow_execution")
    .insert({
      organization_id: rule.organization_id,
      rule_id: rule.id,
      rule_name: rule.name,
      trigger_event: "object_event",
      source_type: event.object.type,
      source_id: event.object.id,
      outcome: "running",
      engine: "graph_v2",
      trigger_event_id: request.test ? null : event.id,
      trigger_payload: event,
      is_test: request.test === true,
      started_at: now().toISOString(),
      actor_kind: "automation",
      actor_id: rule.id,
    })
    .select("id, run_number")
    .single();
  if (createError?.code === UNIQUE_VIOLATION) return { status: "duplicate" };
  if (createError || !created) throw new Error(createError?.message ?? "Could not start the run.");

  const executionId = created.id as string;
  let result: RunResult;
  try {
    result = await runGraph(
      rule.graph,
      { event: eventScope(event), steps: {}, workflow: { id: rule.id, name: rule.name } },
      createRunPorts(db, rule, executionId),
      { dryRun: request.test === true, now },
    );
  } catch (cause) {
    result = {
      outcome: "failed",
      steps: [],
      error: `failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const { error: stepsError } = result.steps.length
    ? await db.from("workflow_execution_step").insert(stepRows(executionId, rule.organization_id, result.steps))
    : { error: null };
  const { error: finishError } = await db
    .from("workflow_execution")
    .update({
      outcome: result.outcome,
      finished_at: now().toISOString(),
      detail: result.error ? result.error.slice(0, 500) : null,
    })
    .eq("id", executionId);
  if (stepsError || finishError) {
    console.error(JSON.stringify({
      event: "workflow.history_write_failed",
      execution: executionId,
      error: (stepsError ?? finishError)?.message,
    }));
  }
  return { status: "recorded", executionId, runNumber: Number(created.run_number), result };
}
