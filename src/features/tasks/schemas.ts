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
