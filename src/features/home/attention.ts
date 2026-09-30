import { addCalendarDays } from "@/lib/time";
import type { TaskPriority, TaskStatus } from "@/types/entities";

/**
 * The attention score (M17c, epic #199): how much an item needs the viewer
 * now, by fixed rules. No model and no learning: every point comes from one
 * of the rules below, and each rule that scores gives a reason the viewer can
 * read ("Website launch in 3 days; 2 of your tasks block it").
 *
 * Rules and points
 *
 *   Deadline closeness (the item's own due date)
 *     overdue                      40, plus 2 a day overdue, up to 60
 *     due today                    35
 *     due tomorrow                 28
 *     due in 2 or 3 days           20
 *     due in 4 to 7 days           10
 *   Project deadline (a task's project, or the project itself when the item
 *   is a project and has no due date of its own besides its target)
 *     project past its target      15
 *     target in 3 days or fewer    15
 *     target in 4 to 7 days         8
 *     target in 8 to 14 days        4
 *   How many items this blocks     8 per open blocked task, up to 24
 *     (for a project: 6 per open task of yours in it, up to 18)
 *   Project priority               critical 12, high 8, medium 3, low 0
 *   Task priority                  critical 10, high 6, medium 2, low 0
 *   Mentions                       6 per unread mention of it, up to 12
 *   Assigned role                  assignee or owner 10, approver 8,
 *                                  reviewer 6, sponsor 6, requester 2
 *   Recent changes                 5 when someone else changed it in the
 *                                  last 48 hours, 8 for three or more changes
 *
 * Ties are broken by due date, then title, then id, so the order is total.
 */

export type AttentionRole = "assignee" | "owner" | "approver" | "reviewer" | "sponsor" | "requester";

export interface AttentionInput {
  kind: "task" | "project";
  id: string;
  title: string;
  /** The item's own due date (a task's due date; a project's target date). */
  due: string | null;
  status?: TaskStatus;
  taskPriority?: TaskPriority | null;
  project?: { name: string; target: string | null; priority: TaskPriority | null } | null;
  role: AttentionRole | null;
  /** Open tasks this task blocks; for a project, the viewer's open tasks in it. */
  blocks: number;
  unreadMentions: number;
  /** Changes by other people in the last 48 hours. */
  recentChanges: number;
}

export type AttentionReason =
  | { rule: "overdue"; points: number; days: number }
  | { rule: "due_today"; points: number }
  | { rule: "due_soon"; points: number; days: number }
  | { rule: "project_overdue"; points: number; project: string }
  | { rule: "project_deadline"; points: number; project: string; days: number }
  | { rule: "blocks"; points: number; count: number }
  | { rule: "my_tasks_in_project"; points: number; count: number }
  | { rule: "project_priority"; points: number; priority: TaskPriority }
  | { rule: "task_priority"; points: number; priority: TaskPriority }
  | { rule: "mentions"; points: number; count: number }
  | { rule: "role"; points: number; role: AttentionRole }
  | { rule: "recent_changes"; points: number; count: number };

export interface AttentionScore {
  score: number;
  /** Every rule that scored, highest first. */
  reasons: AttentionReason[];
}

export const PROJECT_PRIORITY_POINTS: Record<TaskPriority, number> = { critical: 12, high: 8, medium: 3, low: 0 };
export const TASK_PRIORITY_POINTS: Record<TaskPriority, number> = { critical: 10, high: 6, medium: 2, low: 0 };
export const ROLE_POINTS: Record<AttentionRole, number> = {
  assignee: 10,
  owner: 10,
  approver: 8,
  reviewer: 6,
  sponsor: 6,
  requester: 2,
};

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative when past. */
export function daysUntil(today: string, date: string): number {
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function deadlineReason(days: number): AttentionReason | null {
  if (days < 0) return { rule: "overdue", points: Math.min(40 + 2 * -days, 60), days: -days };
  if (days === 0) return { rule: "due_today", points: 35 };
  if (days === 1) return { rule: "due_soon", points: 28, days };
  if (days <= 3) return { rule: "due_soon", points: 20, days };
  if (days <= 7) return { rule: "due_soon", points: 10, days };
  return null;
}

function projectDeadlineReason(project: string, days: number): AttentionReason | null {
  if (days < 0) return { rule: "project_overdue", points: 15, project };
  if (days <= 3) return { rule: "project_deadline", points: 15, project, days };
  if (days <= 7) return { rule: "project_deadline", points: 8, project, days };
  if (days <= 14) return { rule: "project_deadline", points: 4, project, days };
  return null;
}

export function scoreAttention(input: AttentionInput, today: string): AttentionScore {
  const reasons: AttentionReason[] = [];
  const add = (reason: AttentionReason | null) => {
    if (reason && reason.points > 0) reasons.push(reason);
  };

  if (input.kind === "project") {
    if (input.due) add(projectDeadlineReason(input.title, daysUntil(today, input.due)));
    if (input.blocks > 0) add({ rule: "my_tasks_in_project", points: Math.min(6 * input.blocks, 18), count: input.blocks });
  } else {
    if (input.due) add(deadlineReason(daysUntil(today, input.due)));
    if (input.project?.target) add(projectDeadlineReason(input.project.name, daysUntil(today, input.project.target)));
    if (input.blocks > 0) add({ rule: "blocks", points: Math.min(8 * input.blocks, 24), count: input.blocks });
    if (input.taskPriority) {
      add({ rule: "task_priority", points: TASK_PRIORITY_POINTS[input.taskPriority], priority: input.taskPriority });
    }
  }
  const projectPriority = input.project?.priority;
  if (projectPriority) {
    add({ rule: "project_priority", points: PROJECT_PRIORITY_POINTS[projectPriority], priority: projectPriority });
  }
  if (input.unreadMentions > 0) {
    add({ rule: "mentions", points: Math.min(6 * input.unreadMentions, 12), count: input.unreadMentions });
  }
  if (input.role) add({ rule: "role", points: ROLE_POINTS[input.role], role: input.role });
  if (input.recentChanges > 0) {
    add({ rule: "recent_changes", points: input.recentChanges >= 3 ? 8 : 5, count: input.recentChanges });
  }

  // Highest first; equal points keep the order the rules are listed in above.
  const ordered = reasons.map((reason, index) => ({ reason, index }));
  ordered.sort((a, b) => b.reason.points - a.reason.points || a.index - b.index);
  return {
    score: reasons.reduce((sum, reason) => sum + reason.points, 0),
    reasons: ordered.map((entry) => entry.reason),
  };
}

export interface Ranked<T> {
  item: T;
  input: AttentionInput;
  attention: AttentionScore;
}

/** Highest score first; then soonest due, title and id, so the order is total. */
export function rankByAttention<T>(entries: { item: T; input: AttentionInput }[], today: string): Ranked<T>[] {
  return entries
    .map((entry) => ({ ...entry, attention: scoreAttention(entry.input, today) }))
    .sort(
      (a, b) =>
        b.attention.score - a.attention.score ||
        (a.input.due ?? "9999-12-31").localeCompare(b.input.due ?? "9999-12-31") ||
        a.input.title.localeCompare(b.input.title) ||
        a.input.id.localeCompare(b.input.id),
    );
}

/** The date `days` from today, for building inputs in tests and callers. */
export function inDays(today: string, days: number): string {
  return addCalendarDays(today, days) ?? today;
}

/** How many reasons an explanation shows: the strongest two, three at most. */
export const EXPLANATION_REASONS = 2;
