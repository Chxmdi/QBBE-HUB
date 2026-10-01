import { createSupabasePageClient } from "@/lib/supabase/page";
import { activityRowToEvent, activityVerbsFor, type ActivityEventRow } from "../trigger";

/**
 * Reads for the workflow screens, through the signed-in admin's own session so
 * RLS decides what is visible (workflow_rule: members; runs and steps: admins
 * at the two-step sign-in level).
 */

export interface WorkflowListRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  graph: unknown;
  updated_at: string;
  lastRunAt: string | null;
  lastOutcome: string | null;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  graph: unknown;
  definition_version: number;
  max_runs_per_hour: number;
  stopped_at: string | null;
}

export interface RunRow {
  id: string;
  run_number: number;
  outcome: string;
  is_test: boolean;
  detail: string | null;
  source_type: string;
  source_id: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface StepRow {
  id: string;
  position: number;
  step_id: string;
  step_kind: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt: number;
  started_at: string;
  finished_at: string | null;
}

export const RUN_COLUMNS =
  "id, run_number, outcome, is_test, detail, source_type, source_id, started_at, finished_at, created_at";

export async function listWorkflows(organizationId: string): Promise<WorkflowListRow[]> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_rule")
    .select("id, name, description, enabled, graph, updated_at")
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .order("name", { ascending: true });
  const rules = (data ?? []) as Omit<WorkflowListRow, "lastRunAt" | "lastOutcome">[];
  if (rules.length === 0) return [];
  const { data: runs } = await db
    .from("workflow_execution")
    .select("rule_id, outcome, created_at")
    .in("rule_id", rules.map((rule) => rule.id))
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(500);
  const last = new Map<string, { created_at: string; outcome: string }>();
  for (const run of (runs ?? []) as { rule_id: string; outcome: string; created_at: string }[]) {
    if (!last.has(run.rule_id)) last.set(run.rule_id, run);
  }
  return rules.map((rule) => ({
    ...rule,
    lastRunAt: last.get(rule.id)?.created_at ?? null,
    lastOutcome: last.get(rule.id)?.outcome ?? null,
  }));
}

export async function getWorkflow(organizationId: string, id: string): Promise<WorkflowRow | null> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_rule")
    .select("id, name, description, enabled, graph, definition_version, max_runs_per_hour, stopped_at")
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .eq("id", id)
    .maybeSingle();
  return (data as WorkflowRow | null) ?? null;
}

export const runOutcomes = ["running", "waiting", "succeeded", "skipped", "failed", "stopped"] as const;
export type RunOutcomeFilter = (typeof runOutcomes)[number];

export function parseOutcomeFilter(raw: string | undefined): RunOutcomeFilter | null {
  return (runOutcomes as readonly string[]).includes(raw ?? "") ? (raw as RunOutcomeFilter) : null;
}

/** The last runs of one workflow, newest first, narrowed to one outcome when asked. */
export async function listRuns(ruleId: string, limit = 50, outcome: RunOutcomeFilter | null = null): Promise<RunRow[]> {
  const db = await createSupabasePageClient();
  let query = db
    .from("workflow_execution")
    .select(RUN_COLUMNS)
    .eq("rule_id", ruleId)
    .eq("engine", "graph_v2");
  if (outcome) query = query.eq("outcome", outcome);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as RunRow[];
}

export interface FailedRunRow extends RunRow {
  rule_id: string;
  rule_name: string;
  /** The step that failed last, when its record exists. */
  failedStep: { step_id: string; step_kind: string; error: string | null } | null;
}

/**
 * Failed runs with the step that failed, newest first: one workflow's, or
 * every workflow's in the organization when `ruleId` is null (U10).
 */
export async function listFailedRuns(
  ruleId: string | null,
  organizationId: string,
  limit = 20,
): Promise<FailedRunRow[]> {
  const db = await createSupabasePageClient();
  let query = db
    .from("workflow_execution")
    .select(`${RUN_COLUMNS}, rule_id, rule_name`)
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .eq("outcome", "failed")
    .not("rule_id", "is", null);
  if (ruleId) query = query.eq("rule_id", ruleId);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  const runs = (data ?? []) as Omit<FailedRunRow, "failedStep">[];
  if (runs.length === 0) return [];
  const { data: steps } = await db
    .from("workflow_execution_step")
    .select("execution_id, position, step_id, step_kind, error")
    .in("execution_id", runs.map((run) => run.id))
    .eq("status", "failed")
    .order("position", { ascending: false });
  const failed = new Map<string, FailedRunRow["failedStep"]>();
  for (const step of (steps ?? []) as { execution_id: string; step_id: string; step_kind: string; error: string | null }[]) {
    if (!failed.has(step.execution_id)) {
      failed.set(step.execution_id, { step_id: step.step_id, step_kind: step.step_kind, error: step.error });
    }
  }
  return runs.map((run) => ({ ...run, failedStep: failed.get(run.id) ?? null }));
}

/** Other workflows an admin may pick as a sub-workflow. */
export async function listWorkflowNames(organizationId: string): Promise<{ id: string; name: string }[]> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_rule")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .order("name", { ascending: true });
  return (data ?? []) as { id: string; name: string }[];
}

export interface RecentEvent {
  id: string;
  verb: string;
  objectType: string;
  objectId: string;
  summary: string;
  occurredAt: string;
  changes: { property: string; before: unknown; after: unknown }[];
}

const RECENT_EVENT_COLUMNS =
  "id, organization_id, actor_id, verb, source_type, source_id, project_id, program_id, summary, metadata, created_at";

/**
 * The 20 most recent events a trigger would match, as examples for a test run
 * (U10). Through the admin's session: activity_event is readable by members.
 */
export async function listRecentEvents(
  organizationId: string,
  trigger: { objectTypes: readonly string[]; verbs: readonly string[] },
  limit = 20,
): Promise<RecentEvent[]> {
  const db = await createSupabasePageClient();
  let query = db.from("activity_event").select(RECENT_EVENT_COLUMNS).eq("organization_id", organizationId);
  if (trigger.objectTypes.length > 0) query = query.in("source_type", [...trigger.objectTypes]);
  if (trigger.verbs.length > 0) query = query.in("verb", activityVerbsFor(trigger.verbs));
  const { data } = await query.order("created_at", { ascending: false }).limit(limit);
  const events: RecentEvent[] = [];
  for (const row of (data ?? []) as ActivityEventRow[]) {
    const event = activityRowToEvent(row);
    if (!event) continue;
    events.push({
      id: event.id,
      verb: event.verb,
      objectType: event.object.type,
      objectId: event.object.id,
      summary: event.summary,
      occurredAt: event.occurredAt,
      changes: event.changes.map((change) => ({ property: change.property, before: change.before, after: change.after })),
    });
  }
  return events;
}

export interface RunDetail extends RunRow {
  rule_id: string;
  retry_of: string | null;
  parent_execution_id: string | null;
}

/** One run of one workflow, through the admin's session (RLS). */
export async function getRun(ruleId: string, runId: string): Promise<RunDetail | null> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_execution")
    .select(`${RUN_COLUMNS}, rule_id, retry_of, parent_execution_id`)
    .eq("id", runId)
    .eq("rule_id", ruleId)
    .eq("engine", "graph_v2")
    .maybeSingle();
  return (data as RunDetail | null) ?? null;
}

/** Run numbers for a few runs, to name linked runs. */
export async function runNumbers(ids: string[]): Promise<Map<string, { number: number; ruleId: string | null }>> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return new Map();
  const db = await createSupabasePageClient();
  const { data } = await db.from("workflow_execution").select("id, run_number, rule_id").in("id", wanted);
  return new Map(((data ?? []) as { id: string; run_number: number; rule_id: string | null }[])
    .map((row) => [row.id, { number: row.run_number, ruleId: row.rule_id }]));
}

export async function listRunSteps(executionId: string): Promise<StepRow[]> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_execution_step")
    .select("id, position, step_id, step_kind, status, input, output, error, attempt, started_at, finished_at")
    .eq("execution_id", executionId)
    .order("position", { ascending: true });
  return (data ?? []) as StepRow[];
}
