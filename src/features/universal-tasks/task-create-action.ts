import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionDefinition } from "@/lib/objects/contracts";
import { createUniversalTask, type TaskActor, type UniversalTaskInput } from "./create-task";

/**
 * `task.create` for the action registry (plan A8, M13). The stand-in registry
 * checks `capability` on every target before running, so a task in a project
 * needs `edit_content` on that project; a task with no project has no target
 * and relies on the task table's own RLS, as the task form does today.
 */
export function taskCreateAction(
  db: SupabaseClient,
  actor: TaskActor,
): ActionDefinition<UniversalTaskInput> {
  return {
    key: "task.create",
    label: { en: "Create task", fr: "Créer une tâche" },
    capability: "edit_content",
    targets: (input) => (input.projectId ? [input.projectId] : []),
    async run(_context, input) {
      const created = await createUniversalTask(db, actor, input);
      if (!created.ok) throw new Error(`task.create failed: ${created.reason}`);
      return [
        {
          kind: "create",
          object: { id: created.id, type: "task" },
          values: {
            title: input.title,
            project: created.projectId,
            source: input.source ?? { type: "manual", id: null },
          },
        },
      ];
    },
  };
}
