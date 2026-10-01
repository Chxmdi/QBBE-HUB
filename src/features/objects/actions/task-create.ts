import type { ActionDefinition } from "@/lib/objects/contracts";

export const TASK_CREATE_ACTION = "task.create";

/**
 * The creation of a task from one of its own screens (the form, the drawer,
 * a `/task` block in notes), recorded by task.commands as a change set under
 * this key. It is registered so the undo route can reverse it: the inverse of
 * the create is a delete, which the writer applies by archiving the task.
 * Nothing runs it forward through the registry; the screens create the task
 * themselves and record what they did.
 */
export function createTaskCreateAction(): ActionDefinition<never> {
  return {
    key: TASK_CREATE_ACTION,
    label: { en: "Create task", fr: "Créer une tâche" },
    capability: "edit_content",
    targets: () => [],
    async run() {
      throw new Error("A task is created from its own screens, not through the registry.");
    },
  };
}
