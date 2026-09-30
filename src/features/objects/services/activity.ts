import {
  diffTaskFields,
  summarizeChanges,
  type LabelLookup,
  type TaskFieldValues,
  type TrackedTaskField,
} from "@/features/tasks/services/task.history";
import type { StoredChange, StoredObjectEvent } from "./events";

/**
 * Task system property keys (object_event) mapped back to the task columns
 * task history (task.history.ts) tracks, so the feed can render an event
 * exactly as the old writer summarised the same change.
 */
export const TASK_PROPERTY_TO_TRACKED_FIELD: Record<string, TrackedTaskField> = {
  assignee: "assignee_id",
  due: "due_at",
  status: "status",
  priority: "priority",
  project: "project_id",
  milestone: "milestone_id",
  reviewer: "reviewer_id",
  approver: "approver_id",
  completion_criteria: "completion_criteria",
  blocked_reason: "blocked_reason",
};

function isPropertyChange(change: StoredChange): change is Extract<StoredChange, { property: string }> {
  return "property" in change;
}

/** The before and after values of the tracked fields an event changed. */
export function taskFieldValuesFromEvent(changes: StoredChange[]): {
  before: TaskFieldValues;
  after: TaskFieldValues;
} {
  const before: TaskFieldValues = {};
  const after: TaskFieldValues = {};
  for (const change of changes) {
    if (!isPropertyChange(change)) continue;
    const field = TASK_PROPERTY_TO_TRACKED_FIELD[change.property];
    if (!field) continue;
    before[field] = change.before;
    after[field] = change.after;
  }
  return { before, after };
}

/**
 * The one-line summary the activity feed shows for a task event, the same
 * words the old activity_event writers stored (task.commands.ts). `title` is
 * the task's title; `labels` resolves ids to names as the writers did.
 */
export function renderTaskActivitySummary(
  event: Pick<StoredObjectEvent, "verb" | "changes">,
  title: string,
  labels: LabelLookup = {},
): string {
  switch (event.verb) {
    case "created":
      return `created task “${title}”`;
    case "archived":
      return `archived “${title}”`;
    case "deleted":
      return `deleted “${title}”`;
    default: {
      const { before, after } = taskFieldValuesFromEvent(event.changes);
      return summarizeChanges(title, diffTaskFields(before, after, labels));
    }
  }
}
