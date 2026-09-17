import { TASK_STATUS_LABELS } from "@/features/tasks/schemas";
import type { TaskStatus } from "@/types/entities";

/**
 * Material task changes (P0-TSK-05).
 *
 * The acceptance criterion is that changes to owner, due date, status,
 * priority and project are recorded with actor and timestamp. Every mutation
 * already wrote an `activity_event` carrying the actor and the time, but its
 * summary said only that the task was "updated" and its `metadata` stayed
 * empty — so the record could not answer which field moved, or from what to
 * what, which is the only part anyone reads a history for.
 *
 * These functions are pure so the diff can be tested without a database. The
 * command layer supplies the before and after rows; the drawer renders the
 * result.
 */

export const TRACKED_TASK_FIELDS = [
  "assignee_id",
  "due_at",
  "status",
  "priority",
  "project_id",
] as const;

export type TrackedTaskField = (typeof TRACKED_TASK_FIELDS)[number];

export interface TaskFieldChange {
  field: TrackedTaskField;
  from: string | null;
  to: string | null;
  /**
   * Display text resolved at write time. A history entry has to stay readable
   * after the person leaves or the project is renamed, and re-resolving ids on
   * read would also mean joining tables the reader may not be allowed to see.
   */
  fromLabel: string | null;
  toLabel: string | null;
}

export type TaskFieldValues = Partial<Record<TrackedTaskField, unknown>>;

/** Labels for the id-valued fields, keyed by id. */
export type LabelLookup = Record<string, string | undefined>;

const FIELD_LABELS: Record<TrackedTaskField, string> = {
  assignee_id: "Owner",
  due_at: "Due date",
  status: "Status",
  priority: "Priority",
  project_id: "Project",
};

function normalize(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function displayValue(
  field: TrackedTaskField,
  value: string | null,
  labels: LabelLookup,
): string | null {
  if (value === null) return null;
  if (field === "status") {
    return TASK_STATUS_LABELS[value as TaskStatus] ?? value;
  }
  if (field === "priority") return value.charAt(0).toUpperCase() + value.slice(1);
  if (field === "assignee_id" || field === "project_id") {
    return labels[value] ?? null;
  }
  return value;
}

/**
 * The tracked fields that actually differ. Fields absent from `after` are
 * untouched rather than cleared, which is what distinguishes a patch from a
 * replacement — clearing a due date sends an explicit null.
 */
export function diffTaskFields(
  before: TaskFieldValues,
  after: TaskFieldValues,
  labels: LabelLookup = {},
): TaskFieldChange[] {
  const changes: TaskFieldChange[] = [];
  for (const field of TRACKED_TASK_FIELDS) {
    if (!(field in after)) continue;
    const from = normalize(before[field]);
    const to = normalize(after[field]);
    if (from === to) continue;
    changes.push({
      field,
      from,
      to,
      fromLabel: displayValue(field, from, labels),
      toLabel: displayValue(field, to, labels),
    });
  }
  return changes;
}

/** One change, as a person reads it. */
export function describeChange(change: TaskFieldChange): string {
  const name = FIELD_LABELS[change.field];
  const from = change.fromLabel ?? (change.from === null ? null : change.from);
  const to = change.toLabel ?? (change.to === null ? null : change.to);

  if (from === null && to !== null) return `set ${name} to ${to}`;
  if (from !== null && to === null) return `cleared ${name} (was ${from})`;
  if (from === null && to === null) return `changed ${name}`;
  return `changed ${name} from ${from} to ${to}`;
}

/** The activity summary for a whole mutation. */
export function summarizeChanges(title: string, changes: TaskFieldChange[]): string {
  if (changes.length === 0) return `updated “${title}”`;
  return `${changes.map(describeChange).join(", ")} on “${title}”`;
}
