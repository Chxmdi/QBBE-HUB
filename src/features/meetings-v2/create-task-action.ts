import type { ActionDefinition, Change, ObjectRef, Uuid } from "@/lib/objects/contracts";

/**
 * The shared "create task" action (plan M7a), as meetings use it.
 *
 * Contract addition: M7a (stream S5, universal tasks) owns the real action and
 * moves every place that creates tasks onto it. Until it merges, this is the
 * shape meetings build against: one action key, an input that always says
 * where the task came from, and a result in the contract's `Change` form so
 * the action registry can record and later undo it.
 *
 * Only meeting origins are wired here. They go through the existing
 * `public.create_meeting_action`, which creates the task, links it back to the
 * meeting through `meeting_action` (the "where it came from" record) and
 * notifies the owner, all in one transaction and under the meeting's access
 * rule. Other origins throw until M7a replaces this file.
 */
export const CREATE_TASK_ACTION_KEY = "task.create";

export interface CreateTaskInput {
  title: string;
  ownerId?: Uuid | null;
  /** A calendar date, YYYY-MM-DD. */
  dueOn?: string | null;
  /** Where the task came from. Every task records its origin (M7). */
  origin: ObjectRef & { captureId?: Uuid };
}

type Rpc = (
  fn: "create_meeting_action",
  args: { p_meeting: string; p_title: string; p_owner: string | null; p_due: string | null },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export class UnsupportedTaskOriginError extends Error {
  constructor(type: string) {
    super(`Creating a task from a ${type} is not wired until the universal create-task action (M7a).`);
    this.name = "UnsupportedTaskOriginError";
  }
}

export function createTaskActionDefinition(rpc: Rpc): ActionDefinition<CreateTaskInput> {
  return {
    key: CREATE_TASK_ACTION_KEY,
    label: { en: "Create task", fr: "Créer une tâche" },
    capability: "edit_content",
    // The `app.can` stand-in knows tasks and projects only, so a meeting
    // target would always be refused there. The meeting's own rule
    // (app.can_manage_meeting) is enforced inside create_meeting_action
    // instead; M10c's real app.can will know meetings and take this over.
    targets: () => [],
    async run(_context, input): Promise<Change[]> {
      if (input.origin.type !== "meeting") throw new UnsupportedTaskOriginError(input.origin.type);
      const title = input.title.trim();
      if (!title) throw new Error("A task needs a title.");
      const { data, error } = await rpc("create_meeting_action", {
        p_meeting: input.origin.id,
        p_title: title,
        p_owner: input.ownerId ?? null,
        // Due dates are calendar days; noon UTC keeps the day in every zone.
        p_due: input.dueOn ? `${input.dueOn}T12:00:00Z` : null,
      });
      if (error || typeof data !== "string") throw new Error(error?.message ?? "No task was created.");
      return [
        {
          kind: "create",
          object: { type: "task", id: data },
          values: { title, ownerId: input.ownerId ?? null, dueOn: input.dueOn ?? null, origin: input.origin },
        },
      ];
    },
  };
}
