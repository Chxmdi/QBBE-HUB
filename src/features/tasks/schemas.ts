import { z } from "zod";
import { requiredText } from "@/lib/schema";
import type { TaskStatus } from "@/types/entities";

/** Canonical statuses (P0-TSK-02). Shared by board, list, and commands. */
export const TASK_STATUSES = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

/**
 * Status display text. It lives here, beside the canonical statuses and free
 * of React, so the server can name a status in a history entry without
 * importing the badge component that renders one.
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Not started",
  ready: "Ready",
  in_progress: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BOARD_COLUMNS: TaskStatus[] = [...TASK_STATUSES];

export const BULK_STATUSES = TASK_STATUSES.filter(
  (s): s is Exclude<TaskStatus, "blocked"> => s !== "blocked",
);

const BULK_STATUS_ENUM = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "in_review",
  "completed",
  "cancelled",
] as const;

export const createTaskSchema = z.object({
  title: requiredText("A task needs a title.", 300),
  description: z.string().trim().max(5000).optional(),
  projectId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dueAt: z.string().optional(),
  completionCriteria: z.string().trim().max(2000).optional(),
  reviewerId: z.string().uuid().optional(),
  approverId: z.string().uuid().optional(),
  // A task does not always start at "not started" — work is often recorded
  // once it is already under way (P0-TSK-01). Blocked is excluded because it
  // needs a reason, which the create form does not collect.
  status: z.enum(BULK_STATUS_ENUM).optional(),
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  // Fields the create form could already set but nothing could afterwards
  // correct (P0-TSK-01, P0-TSK-02, P0-TSK-04).
  milestoneId: z.string().uuid().nullable().optional(),
  completionCriteria: z.string().trim().max(2000).nullable().optional(),
  reviewerId: z.string().uuid().nullable().optional(),
  approverId: z.string().uuid().nullable().optional(),
  blockedById: z.string().uuid().nullable().optional(),
});

/**
 * Task roles beyond the accountable owner (P0-TSK-02). The owner stays a
 * column on the task because a task has exactly one; these are the many.
 */
export const TASK_ROLES = [
  "contributor",
  "reviewer",
  "approver",
  "follower",
] as const;

export type TaskRole = (typeof TASK_ROLES)[number];

export const TASK_ROLE_LABELS: Record<TaskRole, string> = {
  contributor: "Contributor",
  reviewer: "Reviewer",
  approver: "Approver",
  follower: "Follower",
};

export const taskRoleSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(TASK_ROLES),
});

export const bulkSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["status", "assignee", "priority", "due", "archive"]),
  status: z.enum(BULK_STATUS_ENUM).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().nullable().optional(),
});

export const checklistItemSchema = z.object({
  taskId: z.string().uuid(),
  title: requiredText("A checklist item needs a title.", 300),
});

export const taskDependencySchema = z.object({
  blockingTaskId: z.string().uuid(),
  blockedTaskId: z.string().uuid(),
});

/** Business rule §19: blocked work requires an explanation. */
export function blockedReasonError(
  status: string,
  blockedReason?: string,
): string | null {
  if (status === "blocked" && !blockedReason?.trim()) {
    return "Marking a task blocked requires a reason.";
  }
  return null;
}

/** Reject a new edge whenever the target can already reach its source. */
export function circularDependencyError(
  blockingTaskId: string,
  blockedTaskId: string,
  existing: { blocking_task_id: string; blocked_task_id: string }[],
): string | null {
  if (blockingTaskId === blockedTaskId) {
    return "A task cannot depend on itself.";
  }
  const visited = new Set<string>();
  const pending = [blockedTaskId];
  const outgoing = new Map<string, string[]>();
  for (const edge of existing) {
    const targets = outgoing.get(edge.blocking_task_id) ?? [];
    targets.push(edge.blocked_task_id);
    outgoing.set(edge.blocking_task_id, targets);
  }
  while (pending.length) {
    const id = pending.pop()!;
    if (id === blockingTaskId) return "That dependency would create a cycle.";
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...outgoing.get(id) ?? []);
  }
  return null;
}

/**
 * Labels (P0-TSK-08).
 *
 * `label` and `task_label` have existed since `0001_core.sql`, with correct
 * policies on both — `task_label` insert and delete are gated on
 * `has_task_capability(task_id, 'manage' or 'collaborate')`. Nothing in the
 * product ever wrote a row to either, so the label filter in the bar had an
 * empty list and matched nothing no matter what was chosen. These are the
 * missing write path, not new schema.
 */
export const LABEL_COLORS = [
  "neutral",
  "brand",
  "info",
  "success",
  "warning",
  "danger",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const createLabelSchema = z.object({
  // The table's unique key is (organization_id, name), so two labels differing
  // only by surrounding space would be one label to the database and two to
  // the reader. Trim before it can become that.
  name: requiredText("A label needs a name.", 40),
  color: z.enum(LABEL_COLORS).default("neutral"),
});

export const taskLabelSchema = z.object({
  taskId: z.string().uuid(),
  labelId: z.string().uuid(),
});

/**
 * Advanced planning (#31, P1-TSK-09/10/11/12).
 */

export const milestoneDependencySchema = z.object({
  blockingMilestoneId: z.string().uuid(),
  blockedMilestoneId: z.string().uuid(),
});

/**
 * Reordering sends the whole ordered list rather than one moved item.
 *
 * A "move item 3 above item 1" message has to be applied to the list the
 * sender was looking at, and by the time it arrives that list may have gained
 * an item from somebody else. Sending the order the person actually arranged
 * makes the write idempotent and makes a concurrent edit a last-writer-wins
 * over a visible arrangement instead of a silent reshuffle of a different one.
 */
export const checklistReorderSchema = z.object({
  taskId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1, "Nothing to reorder."),
});

export const taskSeriesSchema = z.object({
  title: requiredText("A recurring task needs a title.", 200),
  projectId: z.string().uuid().nullable().optional(),
  recurrenceRule: z.enum(["weekly", "monthly"]),
  ownerId: z.string().uuid(),
});

/**
 * Calendar rescheduling (P1-TSK-12).
 *
 * The date is a calendar date, not an instant. A drag onto "the 14th" means
 * the 14th in the workspace's zone; sending a timestamp would make the server
 * re-derive a day from an instant and land on the 13th for anyone west of UTC
 * for part of the day. The command resolves the zone, so the wire format stays
 * the thing the user pointed at.
 */
export const rescheduleSchema = z.object({
  kind: z.enum(["task", "milestone"]),
  id: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A reschedule needs a calendar date.")
    .nullable(),
});

/**
 * Whether adding `from -> to` closes a loop in a directed graph.
 *
 * Shared by the task and milestone dependency commands. This is the client-
 * side courtesy check that produces a readable message before a round trip;
 * the guarantee lives in the database triggers, which see edges this caller
 * may not be allowed to read.
 */
export function graphCycleError(
  from: string,
  to: string,
  edges: readonly (readonly [string, string])[],
  selfMessage: string,
): string | null {
  if (from === to) return selfMessage;
  const outgoing = new Map<string, string[]>();
  for (const [source, target] of edges) {
    const targets = outgoing.get(source) ?? [];
    targets.push(target);
    outgoing.set(source, targets);
  }
  const visited = new Set<string>();
  const pending = [to];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === from) return "That dependency would create a cycle.";
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(outgoing.get(id) ?? []));
  }
  return null;
}

export function circularMilestoneDependencyError(
  blockingMilestoneId: string,
  blockedMilestoneId: string,
  existing: { blocking_milestone_id: string; blocked_milestone_id: string }[],
): string | null {
  return graphCycleError(
    blockingMilestoneId,
    blockedMilestoneId,
    existing.map(e => [e.blocking_milestone_id, e.blocked_milestone_id] as const),
    "A milestone cannot depend on itself.",
  );
}
