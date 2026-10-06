import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity, ObjectEvent } from "@/lib/objects/contracts";
import { createActivityFeedWriter } from "@/lib/objects/activity-feed";
import { createWorkflowActionRegistry } from "../actions";
import { runGraph, type EnginePorts, type RunResult, type RunState, type StepRecord } from "../engine";
import { validateGraph, type WorkflowGraph } from "../graph";
import { eventScope } from "../scope";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { recipientIsAllowed, sendEmail } from "@/features/notifications/services/email-provider";
import { checkWebhookUrl, newWebhookSecret, signWebhook, SIGNATURE_HEADER, WEBHOOK_TIMEOUT_MS } from "../webhook";

/**
 * Starts, resumes, retries and records workflow runs (M14a/b, V1-12).
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

export const GRAPH_RULE_COLUMNS = "id, organization_id, name, graph, run_as_user_id, created_by";

export interface RunRequest {
  rule: GraphRule;
  event: ObjectEvent;
  /** A test run from the workflow screen: actions are checked, not run. */
  test?: boolean;
  now?: () => Date;
  /** Set when this run is a sub-workflow of another run. */
  parentExecutionId?: string;
  depth?: number;
  /** "Retry from this step": the run retried, where to start, and its state. */
  retry?: { of: string; stepId: string; state: RunState };
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
  run: { event: ObjectEvent; test: boolean; now?: () => Date },
): EnginePorts {
  const owner = runAsUser(rule);
  const actor: Identity = { kind: "automation", id: rule.id };
  const registry = createWorkflowActionRegistry({
    db,
    organizationId: rule.organization_id,
    workflowId: rule.id,
    runId,
    // Change sets are recorded as the automation and checked for the owner at
    // the same level as `can` below.
    runAs: { userId: owner, assurance: "aal2" },
  });
  const actionContext = {
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
  // The object_event for each change is written by the task trigger with the
  // automation as actor (apply_task_update_as) and labelled with the change
  // set by record_change_set_as. The activity_event row stays for the three
  // readers that still take events from the old feed: the project and program
  // activity pages, the follow fan-out (notifications) and this runner's own
  // trigger stream (trigger.ts), which skips automation events so a workflow
  // never starts itself.
  const writeFeed = createActivityFeedWriter(db);

  return {
    async runAction(key, input) {
      const result = await registry.run(key, input, actionContext);
      if (result.ok) {
        // One feed row per changed object, labelled as the automation, so the
        // activity feed says a workflow did it and the runner skips it.
        for (const change of result.changeSet.changes) {
          if (change.kind !== "update") continue;
          await writeFeed({
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
        if (!(await actionContext.can(target, action.capability))) return "forbidden";
      }
      return "ok";
    },
    async submitApproval({ subjectType, title, description }) {
      if (!owner) throw new Error("the workflow has no owner to submit as.");
      const { data, error } = await db.rpc("workflow_submit_approval", {
        p_user: owner,
        p_organization: rule.organization_id,
        p_subject_type: subjectType,
        p_title: title,
        p_description: description,
      });
      if (error || !data) throw new Error(error?.message ?? "the approval was not submitted.");
      return data as string;
    },
    async createReview({ stepId, reviewerId, instructions }) {
      if (!(await isActiveMember(db, rule.organization_id, reviewerId))) {
        throw new Error("the reviewer is not an active member of the organization.");
      }
      const { data, error } = await db
        .from("workflow_review")
        .insert({
          organization_id: rule.organization_id,
          execution_id: runId,
          step_id: stepId,
          reviewer_id: reviewerId,
          instructions: instructions.slice(0, 2000),
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "the review was not created.");
      const id = data.id as string;
      await createNotifications(db, [{
        user_id: reviewerId,
        organization_id: rule.organization_id,
        category: "assignment",
        title: `Review requested by workflow "${rule.name}"`,
        body: instructions.slice(0, 500),
        source_type: "workflow_review",
        source_id: id,
        link: `/workflows/reviews/${id}`,
        urgency: "normal",
        reason: "workflow",
        dedupe_key: notificationDedupeKey("workflow_review", id, reviewerId),
      }]).catch(() => undefined);
      return id;
    },
    async readDecision(waitingOn) {
      if (waitingOn.kind === "approval") {
        const { data } = await db.from("approval_item").select("status").eq("id", waitingOn.id).maybeSingle();
        const status = (data as { status?: string } | null)?.status;
        return !status || status === "pending" ? null : { status };
      }
      const { data } = await db.from("workflow_review").select("status, comment").eq("id", waitingOn.id).maybeSingle();
      const review = data as { status: string; comment: string | null } | null;
      return !review || review.status === "pending" ? null : { status: review.status, comment: review.comment };
    },
    async callWebhook({ stepId, url, body, attempt }) {
      const checked = await checkWebhookUrl(url);
      if (!checked.ok) return { ok: false, error: `refused: ${checked.reason}.` };
      const secret = await webhookSecret(db, rule);
      const payload = JSON.stringify({
        workflow: { id: rule.id, name: rule.name },
        run: runId,
        step: stepId,
        event: { id: run.event.id, verb: run.event.verb, object: run.event.object },
        data: body,
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(checked.url, {
          method: "POST",
          // A redirect could lead somewhere the address check never saw.
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "user-agent": "QBBE-Hub-Workflows/1",
            [SIGNATURE_HEADER]: signWebhook(secret, payload, timestamp),
            "X-QBBE-Delivery": `${runId}:${stepId}:${attempt}`,
          },
          body: payload,
        });
        if (response.status >= 200 && response.status < 300) return { ok: true, output: { status: response.status } };
        return { ok: false, error: `failed: the receiver answered ${response.status}.` };
      } catch (cause) {
        return { ok: false, error: `failed: ${cause instanceof Error && cause.name === "AbortError" ? "no answer in time" : "the request did not complete"}.` };
      } finally {
        clearTimeout(timer);
      }
    },
    async sendEmail({ stepId, to, subject, body }) {
      const address = to.trim().toLowerCase();
      // Only people in the organization, and only those the environment's
      // allow-list accepts (staging mails nobody real).
      if (!(await isMemberEmail(db, rule.organization_id, address))) {
        return { ok: false, error: "refused: workflows only email active members of the organization." };
      }
      if (!recipientIsAllowed(address)) {
        return { ok: false, error: "refused: recipient_not_allowlisted in this environment." };
      }
      try {
        const sent = await sendEmail({
          idempotencyKey: `workflow:${runId}:${stepId}`,
          to: address,
          subject,
          text: body,
          html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
        });
        return { ok: true, output: { provider: sent.provider } };
      } catch (cause) {
        return { ok: false, error: `failed: ${cause instanceof Error ? cause.message : "the email was not sent"}.` };
      }
    },
    async runSubworkflow(workflowId, depth) {
      const sub = await loadRunnableRule(db, rule.organization_id, workflowId);
      if (!sub) return { outcome: "failed", runNumber: null, error: "unknown_workflow: the sub-workflow does not exist, is off or is stopped." };
      const record = await executeWorkflowRun(db, {
        rule: sub,
        event: run.event,
        test: run.test,
        now: run.now,
        parentExecutionId: runId,
        depth,
      });
      if (record.status !== "recorded") return { outcome: "failed", runNumber: null, error: "failed: the sub-workflow did not start." };
      return { outcome: record.result.outcome, runNumber: record.runNumber, error: record.result.error };
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function isActiveMember(db: SupabaseClient, organizationId: string, userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const { data } = await db
    .from("organization_membership")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return Boolean(data);
}

async function isMemberEmail(db: SupabaseClient, organizationId: string, email: string): Promise<boolean> {
  const { data: profile } = await db.from("user_profile").select("id").eq("email", email).maybeSingle();
  return profile ? isActiveMember(db, organizationId, (profile as { id: string }).id) : false;
}

/** The workflow's signing key, created the first time it is needed. */
export async function webhookSecret(db: SupabaseClient, rule: Pick<GraphRule, "id" | "organization_id">): Promise<string> {
  await db
    .from("workflow_webhook_secret")
    .upsert({ rule_id: rule.id, organization_id: rule.organization_id, secret: newWebhookSecret() }, { onConflict: "rule_id", ignoreDuplicates: true });
  const { data, error } = await db.from("workflow_webhook_secret").select("secret").eq("rule_id", rule.id).single();
  if (error || !data) throw new Error("the signing key is missing.");
  return data.secret as string;
}

/** An enabled, not stopped graph workflow of the organization, or null. */
export async function loadRunnableRule(
  db: SupabaseClient,
  organizationId: string,
  id: string,
): Promise<GraphRule | null> {
  const { data } = await db
    .from("workflow_rule")
    .select(GRAPH_RULE_COLUMNS)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .eq("enabled", true)
    .is("stopped_at", null)
    .maybeSingle();
  if (!data) return null;
  const graph = validateGraph((data as { graph: unknown }).graph);
  return graph.ok ? { ...(data as Omit<GraphRule, "graph">), graph: graph.graph } : null;
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

interface Continuation {
  executionId: string;
  rule: GraphRule;
  event: ObjectEvent;
  test: boolean;
  now: () => Date;
  startAt?: { stepId: string; attempt: number };
  state: RunState;
  positionOffset: number;
}

/** Runs the graph from where the run is, stores its steps and where it stopped. */
async function continueRun(db: SupabaseClient, run: Continuation): Promise<RunResult> {
  let result: RunResult;
  try {
    result = await runGraph(
      run.rule.graph,
      { event: eventScope(run.event), steps: {}, workflow: { id: run.rule.id, name: run.rule.name } },
      createRunPorts(db, run.rule, run.executionId, { event: run.event, test: run.test, now: run.now }),
      { dryRun: run.test, now: run.now, startAt: run.startAt, state: run.state, positionOffset: run.positionOffset },
    );
  } catch (cause) {
    result = {
      outcome: "failed",
      steps: [],
      error: `failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      state: run.state,
      resume: null,
    };
  }

  const { error: stepsError } = result.steps.length
    ? await db.from("workflow_execution_step").insert(stepRows(run.executionId, run.rule.organization_id, result.steps))
    : { error: null };
  const waiting = result.outcome === "waiting" && result.resume;
  const { error: finishError } = await db
    .from("workflow_execution")
    .update({
      outcome: result.outcome,
      finished_at: waiting ? null : run.now().toISOString(),
      detail: result.error ? result.error.slice(0, 500) : null,
      run_state: result.state,
      resume_step_id: waiting ? result.resume!.stepId : null,
      resume_attempt: waiting ? result.resume!.attempt : null,
      resume_at: waiting ? result.resume!.at : null,
      waiting_on_kind: waiting ? result.resume!.waitingOn?.kind ?? null : null,
      waiting_on_id: waiting ? result.resume!.waitingOn?.id ?? null : null,
    })
    .eq("id", run.executionId);
  if (stepsError || finishError) {
    console.error(JSON.stringify({
      event: "workflow.history_write_failed",
      execution: run.executionId,
      error: (stepsError ?? finishError)?.message,
    }));
  }
  return result;
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
      // Only the first, event-started run of a rule claims the event.
      trigger_event_id: request.test || request.parentExecutionId || request.retry ? null : event.id,
      trigger_payload: event,
      is_test: request.test === true,
      started_at: now().toISOString(),
      actor_kind: "automation",
      actor_id: rule.id,
      parent_execution_id: request.parentExecutionId ?? null,
      retry_of: request.retry?.of ?? null,
    })
    .select("id, run_number")
    .single();
  if (createError?.code === UNIQUE_VIOLATION) return { status: "duplicate" };
  if (createError || !created) throw new Error(createError?.message ?? "Could not start the run.");

  const executionId = created.id as string;
  const result = await continueRun(db, {
    executionId,
    rule,
    event,
    test: request.test === true,
    now,
    startAt: request.retry ? { stepId: request.retry.stepId, attempt: 1 } : undefined,
    state: request.retry
      ? { ...request.retry.state, stepsTaken: 0 }
      : { steps: {}, stepsTaken: 0, depth: request.depth ?? 0 },
    positionOffset: 0,
  });
  return { status: "recorded", executionId, runNumber: Number(created.run_number), result };
}

/** Runs started by events in the last hour, against the workflow's limit. */
export async function overRateLimit(db: SupabaseClient, ruleId: string, limit: number, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { count, error } = await db
    .from("workflow_execution")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", ruleId)
    .eq("is_test", false)
    .is("parent_execution_id", null)
    .gte("created_at", since)
    // detail <> 'rate_limit' alone would also drop every run whose detail is null.
    .or("detail.is.null,detail.neq.rate_limit");
  if (error) return false;
  return (count ?? 0) >= limit;
}

/** Records that an event matched but the workflow had used its hourly runs. */
export async function recordRateLimited(db: SupabaseClient, rule: GraphRule, event: ObjectEvent, now: Date) {
  await db.from("workflow_execution").insert({
    organization_id: rule.organization_id,
    rule_id: rule.id,
    rule_name: rule.name,
    trigger_event: "object_event",
    source_type: event.object.type,
    source_id: event.object.id,
    outcome: "skipped",
    engine: "graph_v2",
    trigger_event_id: event.id,
    trigger_payload: event,
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    actor_kind: "automation",
    actor_id: rule.id,
    detail: "rate_limit",
  });
}

export interface WaitingRunRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  is_test: boolean;
  trigger_payload: ObjectEvent;
  run_state: RunState | null;
  resume_step_id: string | null;
  resume_attempt: number | null;
}

export const WAITING_RUN_COLUMNS =
  "id, organization_id, rule_id, is_test, trigger_payload, run_state, resume_step_id, resume_attempt";

export type ResumeOutcome = "resumed" | "stopped" | "claimed_elsewhere";

/**
 * Continues a waiting run at its resume step. The run is claimed first
 * (waiting to running, only if still waiting), so two workers never continue
 * the same run. A stopped, switched-off or deleted workflow stops the run.
 */
export async function resumeWaitingRun(
  db: SupabaseClient,
  row: WaitingRunRow,
  now: () => Date = () => new Date(),
): Promise<ResumeOutcome> {
  const { data: claimed } = await db
    .from("workflow_execution")
    .update({ outcome: "running" })
    .eq("id", row.id)
    .eq("outcome", "waiting")
    .select("id")
    .maybeSingle();
  if (!claimed) return "claimed_elsewhere";

  const rule = row.rule_id ? await loadRunnableRule(db, row.organization_id, row.rule_id) : null;
  if (!rule || !row.resume_step_id) {
    await db
      .from("workflow_execution")
      .update({ outcome: "stopped", finished_at: now().toISOString(), detail: "stopped: the workflow was stopped, switched off or removed.", resume_at: null })
      .eq("id", row.id);
    return "stopped";
  }

  const { count } = await db
    .from("workflow_execution_step")
    .select("id", { count: "exact", head: true })
    .eq("execution_id", row.id);
  await continueRun(db, {
    executionId: row.id,
    rule,
    event: row.trigger_payload,
    test: row.is_test,
    now,
    startAt: { stepId: row.resume_step_id, attempt: row.resume_attempt ?? 1 },
    state: row.run_state ?? { steps: {}, stepsTaken: 0, depth: 0 },
    positionOffset: count ?? 0,
  });
  return "resumed";
}

/** The run's state without the retried step's own output, so it starts afresh. */
function freshFrom(state: RunState | null, stepId: string): RunState {
  const steps = { ...(state?.steps ?? {}) };
  delete steps[stepId];
  return { steps, stepsTaken: 0, depth: state?.depth ?? 0 };
}

/**
 * "Retry from this step": a new run of the same workflow and event, starting
 * at `stepId` with the step outputs the earlier run had. The earlier run is
 * left as it was, so its history stays true.
 */
export async function retryRunFromStep(
  db: SupabaseClient,
  executionId: string,
  stepId: string,
  organizationId: string,
): Promise<RunRecord | { status: "not_found" | "not_retryable" }> {
  const { data } = await db
    .from("workflow_execution")
    .select(`${WAITING_RUN_COLUMNS}, outcome`)
    .eq("id", executionId)
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .maybeSingle();
  const row = data as (WaitingRunRow & { outcome: string }) | null;
  if (!row || !row.rule_id) return { status: "not_found" };
  if (!["failed", "stopped", "succeeded", "skipped"].includes(row.outcome)) return { status: "not_retryable" };
  const rule = await loadRunnableRule(db, organizationId, row.rule_id);
  if (!rule || !rule.graph.steps.some((step) => step.id === stepId)) return { status: "not_retryable" };
  return executeWorkflowRun(db, {
    rule,
    event: row.trigger_payload,
    test: row.is_test,
    retry: { of: row.id, stepId, state: freshFrom(row.run_state, stepId) },
  });
}
