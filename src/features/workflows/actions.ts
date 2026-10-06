import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  ActionContext,
  ActionDefinition,
  ActionRegistry,
  Change,
  Identity,
} from "@/lib/objects/contracts";
import { createActionRegistry, type ObjectWriter } from "@/features/objects/actions/registry";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { actionInputSchemas, workflowActionLabels, type WorkflowActionKey } from "./actions-catalog";

export { actionInputSchemas, taskPriorities, taskStatuses, workflowActionKeys, workflowActionLabels } from "./actions-catalog";
export type { WorkflowActionKey } from "./actions-catalog";

/**
 * The actions a workflow (or an API token) can run, on the persisted action
 * registry (M13).
 *
 * Each one is an `ActionDefinition` from the contract. The registry checks the
 * declared capability on every target, as the person the run acts for, before
 * `run`; afterwards it records a change set through
 * public.record_change_set_as, labelled with the automation or integration
 * and checked again for that person (`runAs`).
 *
 * Writes go through the service client because the permission check has
 * already been made for the owner. A task change goes through
 * public.apply_task_update_as, which sets app.actor for the write so the
 * object_event the task trigger records names the automation, not 'system'.
 */

export interface WorkflowActionEnvironment {
  db: SupabaseClient;
  organizationId: string;
  workflowId: string;
  /** The run, so a retried step does not notify the same person twice. */
  runId: string;
  /** Whose permissions the run acts with, and the sign-in level to ask at. */
  runAs: { userId: string | null; assurance: "aal1" | "aal2" };
}

class ActionInputError extends Error {}

function parse<K extends WorkflowActionKey>(key: K, input: unknown): z.infer<(typeof actionInputSchemas)[K]> {
  const parsed = actionInputSchemas[key].safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ActionInputError(`Invalid input for ${key}: ${issue?.path.join(".") || "input"} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data as z.infer<(typeof actionInputSchemas)[K]>;
}

/** Targets for the capability check. Bad input has no targets and fails in `run`. */
function targetsOf(key: WorkflowActionKey) {
  return (input: unknown) => {
    const parsed = actionInputSchemas[key].safeParse(input);
    if (!parsed.success) return [];
    return "taskId" in parsed.data ? [parsed.data.taskId] : [];
  };
}

type TaskColumn = "status" | "priority" | "assignee_id";

/** The actor as app.actor spells it: automation:<workflow id>, integration:<name>. */
export function actorSetting(actor: Identity): string {
  return `${actor.kind}:${actor.id}`;
}

async function readTaskColumn(env: WorkflowActionEnvironment, taskId: string, column: TaskColumn): Promise<unknown> {
  const { data: before, error: readError } = await env.db
    .from("task")
    .select(`id, organization_id, ${column}`)
    .eq("id", taskId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const row = before as Record<string, unknown> | null;
  if (!row || row.organization_id !== env.organizationId) throw new Error("The task does not exist.");
  return row[column] ?? null;
}

async function updateTaskColumn(
  env: WorkflowActionEnvironment,
  actor: Identity,
  taskId: string,
  column: TaskColumn,
  property: string,
  value: string | null,
): Promise<Change[]> {
  const previous = await readTaskColumn(env, taskId, column);
  if (previous === value) return [];
  const patch: Record<string, unknown> = { [column]: value };
  if (column === "status") patch.completed_at = value === "completed" ? new Date().toISOString() : null;
  const { data, error } = await env.db.rpc("apply_task_update_as", {
    p_actor: actorSetting(actor),
    p_organization: env.organizationId,
    p_task: taskId,
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The task does not exist.");
  return [{ kind: "update", object: { id: taskId, type: "task" }, property, before: previous, after: value }];
}

function definitions(env: WorkflowActionEnvironment): ActionDefinition[] {
  return [
    {
      key: "task.set_status",
      label: workflowActionLabels["task.set_status"],
      capability: "edit_content",
      targets: targetsOf("task.set_status"),
      run: async (context, input) => {
        const { taskId, status } = parse("task.set_status", input);
        return updateTaskColumn(env, context.actor, taskId, "status", "status", status);
      },
    },
    {
      key: "task.set_priority",
      label: workflowActionLabels["task.set_priority"],
      capability: "edit_content",
      targets: targetsOf("task.set_priority"),
      run: async (context, input) => {
        const { taskId, priority } = parse("task.set_priority", input);
        return updateTaskColumn(env, context.actor, taskId, "priority", "priority", priority);
      },
    },
    {
      key: "task.assign",
      label: workflowActionLabels["task.assign"],
      capability: "edit_content",
      targets: targetsOf("task.assign"),
      run: async (context, input) => {
        const { taskId, assigneeId } = parse("task.assign", input);
        if (assigneeId) await requireActiveMember(env, assigneeId);
        return updateTaskColumn(env, context.actor, taskId, "assignee_id", "assignee", assigneeId);
      },
    },
    {
      key: "notification.send",
      label: workflowActionLabels["notification.send"],
      // No object is touched; the recipient must belong to the organization.
      capability: "view",
      targets: targetsOf("notification.send"),
      run: async (_context, input) => {
        const { userId, title, link } = parse("notification.send", input);
        await requireActiveMember(env, userId);
        await createNotifications(env.db, [{
          user_id: userId,
          organization_id: env.organizationId,
          category: "assignment",
          title,
          source_type: "workflow",
          source_id: env.workflowId,
          link: link ?? null,
          urgency: "normal",
          reason: "workflow",
          dedupe_key: notificationDedupeKey("workflow", env.workflowId, userId, env.runId),
        }]);
        return [];
      },
    },
  ];
}

async function requireActiveMember(env: WorkflowActionEnvironment, userId: string) {
  const { data, error } = await env.db
    .from("organization_membership")
    .select("user_id")
    .eq("organization_id", env.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That person is not an active member of the organization.");
}

const TASK_COLUMNS: Record<string, TaskColumn> = {
  status: "status",
  priority: "priority",
  assignee: "assignee_id",
};

function taskColumn(change: Change): { id: string; column: TaskColumn } {
  if (change.kind !== "update" || change.object.type !== "task" || !TASK_COLUMNS[change.property]) {
    throw new Error("This change cannot be undone by a workflow.");
  }
  return { id: change.object.id, column: TASK_COLUMNS[change.property] };
}

/** Undo for the registry: only the task columns these actions write. */
function workflowWriter(env: WorkflowActionEnvironment): ObjectWriter {
  return {
    async apply(changes: Change[], context: ActionContext) {
      for (const change of changes) {
        const { id, column } = taskColumn(change);
        if (change.kind !== "update") continue;
        await updateTaskColumn(env, context.actor, id, column, change.property, change.after as string | null);
      }
    },
    async read(change) {
      const { id, column } = taskColumn(change);
      return readTaskColumn(env, id, column);
    },
  };
}

export function createWorkflowActionRegistry(env: WorkflowActionEnvironment): ActionRegistry {
  const registry = createActionRegistry({
    store: createSupabaseChangeSetStore(env.db, { runAs: env.runAs }),
    writer: workflowWriter(env),
    // A step that changes nothing (the status is already set, a notification
    // was sent) succeeds, as it always did; there is no change set to record.
    onEmpty: "ok",
  });
  for (const definition of definitions(env)) registry.register(definition);
  return registry;
}
