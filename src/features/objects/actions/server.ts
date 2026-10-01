import type { ActionContext, ActionRegistry } from "@/lib/objects/contracts";
import { createCan } from "@/lib/objects/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUniversalTask, type TaskActor } from "@/features/universal-tasks/create-task";
import { taskCreateChange } from "@/features/tasks/services/task.change-sets";
import { createActionRegistry } from "./registry";
import { createSetPropertyAction } from "./set-property";
import { createTaskCreateAction } from "./task-create";
import { createSupabaseChangeSetStore } from "./supabase-store";
import { createSupabaseObjectWriter } from "./supabase-writer";

/**
 * The registry for one request, acting as the signed-in person through their
 * own client: every read and write is under their RLS, and `can` is the
 * database's own access check (app.can, M10c).
 *
 * `taskActor` lets `task.create` run forward (a button block, U5b): the task
 * is made by the shared create-task action under the same client, and the
 * registry records the change set. `onTaskCreated` hears of the new task as
 * soon as it exists, so a caller can still report it if recording the change
 * set then fails (the task stands; only its undo is missing).
 */
export async function createRequestActionRegistry(
  userId: string,
  options: { taskActor?: TaskActor; onTaskCreated?: (taskId: string) => void } = {},
): Promise<{
  registry: ActionRegistry;
  context: ActionContext;
}> {
  const client = await createSupabaseServerClient();
  const writer = createSupabaseObjectWriter(client);
  const registry = createActionRegistry({ store: createSupabaseChangeSetStore(client), writer });
  registry.register(createSetPropertyAction(writer));
  const actor = options.taskActor;
  registry.register(
    createTaskCreateAction(
      actor
        ? async (_context, input) => {
            const created = await createUniversalTask(client, actor, {
              title: input.title,
              ...(input.projectId ? { projectId: input.projectId } : {}),
              source: input.source ?? { type: "manual", id: null },
            });
            if (!created.ok) throw new Error(created.reason);
            options.onTaskCreated?.(created.id);
            return [
              taskCreateChange(created.id, {
                title: input.title,
                project_id: input.projectId ?? null,
                priority: "medium",
                status: "not_started",
              }),
            ];
          }
        : undefined,
    ),
  );
  return { registry, context: { actor: { kind: "person", id: userId }, can: createCan(client) } };
}

/** HTTP status for an action result, shared by the API routes. */
export function statusForActionFailure(reason: "unknown_action" | "forbidden" | "failed", message?: string): number {
  if (reason === "forbidden") return 403;
  if (reason === "unknown_action") return 404;
  if (message?.startsWith("conflict:")) return 409;
  return 422;
}
