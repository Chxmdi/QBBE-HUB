"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ObjectEvent } from "@/lib/objects/contracts";
import { workflowActionKeys } from "../actions-catalog";
import { saveWorkflowSchema, testRunSchema } from "../editor-model";
import { validateGraph } from "../graph";
import { fill, workflowMessages } from "../i18n";
import { executeWorkflowRun, type GraphRule } from "./run";

/**
 * Saving and test-running workflows (M14c). Admins only, at the two-step
 * sign-in level, and only while wos_workflows_v2 is on.
 */

export type WorkflowCommandResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface TestRunStep {
  position: number;
  stepId: string;
  kind: string;
  status: string;
  error: string | null;
}

export type TestRunResult =
  | { ok: true; runNumber: number; outcome: string; error: string | null; steps: TestRunStep[] }
  | { ok: false; error: string };

async function guard(): Promise<
  | { ok: true; userId: string; organizationId: string; m: ReturnType<typeof workflowMessages> }
  | { ok: false; error: string }
> {
  const m = workflowMessages(await getLocale());
  if (!(await isEnabled("wos_workflows_v2"))) return { ok: false, error: m.errors.notFound };
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  return { ok: true, userId: authorization.session.userId, organizationId: authorization.session.organizationId, m };
}

export async function saveWorkflow(input: unknown): Promise<WorkflowCommandResult> {
  const checked = await guard();
  if (!checked.ok) return checked;
  const { m } = checked;

  const parsed = saveWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: fill(m.errors.invalid, { detail: parsed.error.issues[0]?.message ?? "" }) };
  }
  const graph = validateGraph(parsed.data.graph, new Set(workflowActionKeys));
  if (!graph.ok) {
    return { ok: false, error: fill(m.errors.invalid, { detail: graph.issues[0].message }) };
  }

  // The admin's own session: the existing workflow_rule policy (admins only)
  // decides, not this code.
  const db = await createSupabaseServerClient();
  const row = {
    name: parsed.data.name,
    description: parsed.data.description || null,
    enabled: parsed.data.enabled,
    graph: graph.graph,
    updated_by: checked.userId,
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.id) {
    const { data: current } = await db
      .from("workflow_rule")
      .select("definition_version")
      .eq("id", parsed.data.id)
      .eq("organization_id", checked.organizationId)
      .eq("engine", "graph_v2")
      .maybeSingle();
    if (!current) return { ok: false, error: m.errors.notFound };
    const { error } = await db
      .from("workflow_rule")
      .update({ ...row, definition_version: (current.definition_version as number) + 1 })
      .eq("id", parsed.data.id)
      .eq("organization_id", checked.organizationId);
    if (error) return { ok: false, error: m.errors.saveFailed };
    revalidatePath("/workflows");
    return { ok: true, id: parsed.data.id };
  }

  const { data, error } = await db
    .from("workflow_rule")
    .insert({
      ...row,
      organization_id: checked.organizationId,
      trigger_event: "object_event",
      engine: "graph_v2",
      condition: {},
      action: {},
      run_as_user_id: checked.userId,
      created_by: checked.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: m.errors.saveFailed };
  revalidatePath("/workflows");
  return { ok: true, id: data.id as string };
}

/**
 * Runs the saved workflow once with a sample "status changed" event. Actions
 * are checked as the workflow's owner and not carried out.
 */
export async function testRunWorkflow(input: unknown): Promise<TestRunResult> {
  const checked = await guard();
  if (!checked.ok) return checked;
  const { m } = checked;
  const parsed = testRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.invalidId };

  // Read through the admin's session first, so RLS confirms they may see it.
  const userDb = await createSupabaseServerClient();
  const { data: visible } = await userDb
    .from("workflow_rule")
    .select("id, organization_id, name, graph, run_as_user_id, created_by")
    .eq("id", parsed.data.id)
    .eq("organization_id", checked.organizationId)
    .eq("engine", "graph_v2")
    .maybeSingle();
  if (!visible) return { ok: false, error: m.errors.notFound };
  const graph = validateGraph(visible.graph);
  if (!graph.ok) return { ok: false, error: fill(m.errors.invalid, { detail: graph.issues[0].message }) };

  const rule: GraphRule = { ...(visible as Omit<GraphRule, "graph">), graph: graph.graph };
  const objectType = rule.graph.trigger.objectTypes[0] ?? "task";
  const event: ObjectEvent = {
    id: crypto.randomUUID(),
    organizationId: checked.organizationId,
    object: { id: parsed.data.objectId, type: objectType },
    actor: { kind: "person", id: checked.userId },
    verb: rule.graph.trigger.verbs[0] ?? "updated",
    changes: [{
      property: rule.graph.trigger.changedProperty ?? "status",
      before: parsed.data.before || null,
      after: parsed.data.after || null,
    }],
    summary: "Test run",
    occurredAt: new Date().toISOString(),
  };

  try {
    const record = await executeWorkflowRun(createSupabaseServiceClient(), { rule, event, test: true });
    if (record.status !== "recorded") return { ok: false, error: m.errors.testFailed };
    revalidatePath(`/workflows/${rule.id}`);
    return {
      ok: true,
      runNumber: record.runNumber,
      outcome: record.result.outcome,
      error: record.result.error,
      steps: record.result.steps.map((step) => ({
        position: step.position,
        stepId: step.stepId,
        kind: step.kind,
        status: step.status,
        error: step.error,
      })),
    };
  } catch {
    return { ok: false, error: m.errors.testFailed };
  }
}
