import { createSupabasePageClient } from "@/lib/supabase/page";

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
    .select("id, name, description, enabled, graph, definition_version")
    .eq("organization_id", organizationId)
    .eq("engine", "graph_v2")
    .eq("id", id)
    .maybeSingle();
  return (data as WorkflowRow | null) ?? null;
}

export async function listRuns(ruleId: string, limit = 50): Promise<RunRow[]> {
  const db = await createSupabasePageClient();
  const { data } = await db
    .from("workflow_execution")
    .select(RUN_COLUMNS)
    .eq("rule_id", ruleId)
    .eq("engine", "graph_v2")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RunRow[];
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
