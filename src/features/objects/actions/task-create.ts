import type { ActionContext, ActionDefinition, Change } from "@/lib/objects/contracts";

export const TASK_CREATE_ACTION = "task.create";

/** What a forward run of `task.create` takes (a button block, U5b). */
export interface TaskCreateInput {
  title: string;
  projectId?: string;
  source?: { type: "page" | "meeting"; id: string };
}

/**
 * The creation of a task from one of its own screens (the form, the drawer,
 * a `/task` block in notes), recorded by task.commands as a change set under
 * this key. It is registered so the undo route can reverse it: the inverse of
 * the create is a delete, which the writer applies by archiving the task.
 *
 * The screens create the task themselves and record what they did. Only a
 * caller that passes `create` (a button block) runs it forward through the
 * registry, which then records the change set; without it a forward run is
 * refused, as before.
 */
export function createTaskCreateAction(
  create?: (context: ActionContext, input: TaskCreateInput) => Promise<Change[]>,
): ActionDefinition<TaskCreateInput> {
  return {
    key: TASK_CREATE_ACTION,
    label: { en: "Create task", fr: "Créer une tâche" },
    capability: "edit_content",
    // A new task has no object to check yet: RLS on `task` (the project's
    // scope rules) decides the insert, as it does for the task form.
    targets: () => [],
    async run(context, input) {
      if (!create) throw new Error("A task is created from its own screens, not through the registry.");
      return create(context, input);
    },
  };
}
