import type { Change } from "@/lib/objects/contracts";
import { reportError } from "@/lib/observability";
import { SET_PROPERTY_ACTION } from "@/features/objects/actions/set-property";
import { TASK_CREATE_ACTION } from "@/features/objects/actions/task-create";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * A task's own screens (the form, the drawer, the board, a `/task` block in
 * notes) write the task table directly, so the registry's change sets (M13)
 * were only written by workflows, API tokens and bulk edit. These helpers
 * record what those screens did as change sets too, under the signed-in
 * person, so POST /api/objects/change-sets/:id/undo can put it back.
 *
 * An update is recorded as `object.set_property` on the task's registered
 * properties (one change per property that actually changed), which is what
 * the undo route's writer knows how to reverse. A creation is recorded as
 * `task.create`; undoing it archives the task.
 */

export { TASK_CREATE_ACTION };

/** Task columns the screens change, and the registry property each one is. */
const PROPERTY_FOR_COLUMN = {
  title: "title",
  assignee_id: "assignee",
  due_at: "due",
  status: "status",
  priority: "priority",
  project_id: "project",
  milestone_id: "milestone",
  reviewer_id: "reviewer",
  approver_id: "approver",
  completion_criteria: "completion_criteria",
  blocked_reason: "blocked_reason",
} as const;

export type ChangeSetColumn = keyof typeof PROPERTY_FOR_COLUMN;
export type TaskColumnValues = Partial<Record<ChangeSetColumn, unknown>>;

const normalize = (value: unknown) => (value === undefined || value === "" ? null : value);

/** One update change per column whose value differs between `before` and `after`. */
export function taskUpdateChanges(taskId: string, before: TaskColumnValues, after: TaskColumnValues): Change[] {
  const changes: Change[] = [];
  for (const column of Object.keys(PROPERTY_FOR_COLUMN) as ChangeSetColumn[]) {
    if (!(column in after)) continue;
    const from = normalize(before[column]);
    const to = normalize(after[column]);
    if (from === to) continue;
    changes.push({
      kind: "update",
      object: { id: taskId, type: "task" },
      property: PROPERTY_FOR_COLUMN[column],
      before: from,
      after: to,
    });
  }
  return changes;
}

/** The creation of a task, with the values its row started with. */
export function taskCreateChange(taskId: string, values: TaskColumnValues): Change {
  const kept: Record<string, unknown> = {};
  for (const column of Object.keys(PROPERTY_FOR_COLUMN) as ChangeSetColumn[]) {
    if (column in values && normalize(values[column]) !== null) kept[column] = values[column];
  }
  return { kind: "create", object: { id: taskId, type: "task" }, values: kept };
}

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "rpc">;

/**
 * Record the change set under the caller's own session. The task is already
 * saved when this runs; a change set that cannot be written is reported, not
 * turned into a failed save, because the record exists to undo the save and
 * must never prevent it.
 */
export async function recordTaskChangeSet(
  client: Client,
  actionKey: typeof SET_PROPERTY_ACTION | typeof TASK_CREATE_ACTION,
  changes: Change[],
): Promise<string | null> {
  if (changes.length === 0) return null;
  const { data, error } = await client.rpc("record_change_set", {
    p_action_key: actionKey,
    p_changes: changes,
  });
  if (error || !data) {
    reportError(new Error(`Task change set not recorded: ${error?.message ?? "no row"}`), {
      scope: "tasks.change-set",
      actionKey,
    });
    return null;
  }
  return (data as { id: string }).id;
}
