import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type {
  ActionDefinition,
  ActionRegistry,
  Change,
} from "@/lib/objects/contracts";
import { createActionRegistryStub } from "@/lib/objects/stubs";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { actionInputSchemas, workflowActionLabels, type WorkflowActionKey } from "./actions-catalog";

export { actionInputSchemas, taskPriorities, taskStatuses, workflowActionKeys, workflowActionLabels } from "./actions-catalog";
export type { WorkflowActionKey } from "./actions-catalog";

/**
 * The actions a workflow can run, until S1's persisted registry lands (M13).
 *
 * Each one is an `ActionDefinition` from the contract, registered on the
 * contract's in-memory stand-in, so swapping in the real registry changes
 * `createWorkflowActionRegistry` and nothing else. The registry checks the
 * declared capability on every target (as the workflow's owner) before `run`.
 *
 * Writes use the service client because the permission check has already been
 * made for the owner; the change is labelled as the automation.
 */

export interface WorkflowActionEnvironment {
  db: SupabaseClient;
  organizationId: string;
  workflowId: string;
  /** The run, so a retried step does not notify the same person twice. */
  runId: string;
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

async function updateTaskColumn(
  env: WorkflowActionEnvironment,
  taskId: string,
  column: "status" | "priority" | "assignee_id",
  property: string,
  value: string | null,
): Promise<Change[]> {
  const { data: before, error: readError } = await env.db
    .from("task")
    .select(`id, organization_id, ${column}`)
    .eq("id", taskId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const row = before as Record<string, unknown> | null;
  if (!row || row.organization_id !== env.organizationId) throw new Error("The task does not exist.");
  const previous = row[column] ?? null;
  if (previous === value) return [];
  const patch: Record<string, unknown> = { [column]: value };
  if (column === "status") patch.completed_at = value === "completed" ? new Date().toISOString() : null;
  const { error } = await env.db.from("task").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);
  return [{ kind: "update", object: { id: taskId, type: "task" }, property, before: previous, after: value }];
}

function definitions(env: WorkflowActionEnvironment): ActionDefinition[] {
  return [
    {
      key: "task.set_status",
      label: workflowActionLabels["task.set_status"],
      capability: "edit_content",
      targets: targetsOf("task.set_status"),
      run: async (_context, input) => {
        const { taskId, status } = parse("task.set_status", input);
        return updateTaskColumn(env, taskId, "status", "status", status);
      },
    },
    {
      key: "task.set_priority",
      label: workflowActionLabels["task.set_priority"],
      capability: "edit_content",
      targets: targetsOf("task.set_priority"),
      run: async (_context, input) => {
        const { taskId, priority } = parse("task.set_priority", input);
        return updateTaskColumn(env, taskId, "priority", "priority", priority);
      },
    },
    {
      key: "task.assign",
      label: workflowActionLabels["task.assign"],
      capability: "edit_content",
      targets: targetsOf("task.assign"),
      run: async (_context, input) => {
        const { taskId, assigneeId } = parse("task.assign", input);
        if (assigneeId) await requireActiveMember(env, assigneeId);
        return updateTaskColumn(env, taskId, "assignee_id", "assignee", assigneeId);
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

/** Reverses changes for undo. Only the task columns these actions write. */
async function applyChanges(env: WorkflowActionEnvironment, changes: Change[]) {
  const columns: Record<string, "status" | "priority" | "assignee_id"> = {
    status: "status",
    priority: "priority",
    assignee: "assignee_id",
  };
  for (const change of changes) {
    if (change.kind !== "update" || change.object.type !== "task" || !columns[change.property]) {
      throw new Error("This change cannot be undone by a workflow.");
    }
    await updateTaskColumn(env, change.object.id, columns[change.property], change.property, change.after as string | null);
  }
}

export function createWorkflowActionRegistry(env: WorkflowActionEnvironment): ActionRegistry {
  const registry = createActionRegistryStub({
    apply: (changes: Change[]) => applyChanges(env, changes),
  });
  for (const definition of definitions(env)) registry.register(definition);
  return registry;
}
