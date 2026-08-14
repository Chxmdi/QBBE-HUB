import { z } from "zod";
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
  title: z.string().trim().min(1, "A task needs a title.").max(300),
  description: z.string().trim().max(5000).optional(),
  projectId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dueAt: z.string().optional(),
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
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
  title: z.string().trim().min(1, "A checklist item needs a title.").max(300),
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

/** Rejects a self-dependency or an A→B plus B→A pair (P1-TSK-06). */
export function circularDependencyError(
  blockingTaskId: string,
  blockedTaskId: string,
  existing: { blocking_task_id: string; blocked_task_id: string }[],
): string | null {
  if (blockingTaskId === blockedTaskId) {
    return "A task cannot depend on itself.";
  }
  const wouldCycle = existing.some(
    (row) =>
      row.blocking_task_id === blockedTaskId &&
      row.blocked_task_id === blockingTaskId,
  );
  if (wouldCycle) {
    return "That dependency would create a cycle.";
  }
  return null;
}
