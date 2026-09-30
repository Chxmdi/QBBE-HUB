import { addCalendarDays } from "@/lib/time";

/**
 * What-if timeline (V3-4): shift one milestone and see what moves with it,
 * before anything is saved.
 *
 * The rules, in the words the page uses:
 *   - The milestone's own open tasks move by the same number of days.
 *   - Anything a moved milestone or task blocks (milestone_dependency,
 *     task_dependency) moves only as much as it must to stay due after its
 *     blocker; slack it already has is used up first. Moving a blocked
 *     milestone moves its own open tasks with it.
 *   - Moving something earlier never pulls what depends on it earlier.
 *   - A project moves when its latest date moves; a goal (outcome metric) in
 *     that project's programme is flagged when the project would now finish
 *     after the goal's target date.
 * Pure and deterministic; the page previews it and the apply action
 * recomputes it from fresh data before writing anything.
 */

export interface PlanMilestone {
  id: string;
  name: string;
  projectId: string;
  due: string | null;
}

export interface PlanTask {
  id: string;
  title: string;
  projectId: string | null;
  milestoneId: string | null;
  start: string | null;
  due: string | null;
  /** Completed and cancelled tasks never move. */
  closed: boolean;
}

export interface PlanProject {
  id: string;
  name: string;
  programId: string | null;
  targetDate: string | null;
}

export interface PlanGoal {
  id: string;
  name: string;
  programId: string;
  targetOn: string | null;
}

export interface Schedule {
  milestones: PlanMilestone[];
  tasks: PlanTask[];
  projects: PlanProject[];
  goals: PlanGoal[];
  milestoneDeps: { blocking: string; blocked: string }[];
  taskDeps: { blocking: string; blocked: string }[];
}

export interface DateMove {
  id: string;
  name: string;
  projectId: string | null;
  from: string;
  to: string;
  /** Why it moved: the shifted milestone itself, as part of a milestone, or because something blocking it moved. */
  reason: "shifted" | "in_milestone" | "blocked_by";
  /** The milestone or task that pushed it. */
  cause: string | null;
}

export interface TaskMove extends DateMove {
  startFrom: string | null;
  startTo: string | null;
}

export interface ProjectMove {
  id: string;
  name: string;
  from: string | null;
  to: string;
  /** The project's own target date, when the new finish passes it. */
  pastTarget: string | null;
}

export interface GoalImpact {
  id: string;
  name: string;
  targetOn: string;
  projectId: string;
  projectFinish: string;
}

export interface ShiftPlan {
  milestoneId: string;
  days: number;
  milestones: DateMove[];
  tasks: TaskMove[];
  projects: ProjectMove[];
  goals: GoalImpact[];
}

export const MAX_SHIFT_DAYS = 365;

export function clampDays(raw: unknown): number {
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, -MAX_SHIFT_DAYS), MAX_SHIFT_DAYS);
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const shift = (date: string, days: number) => addCalendarDays(date, days)!;
const later = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

export function planShift(schedule: Schedule, milestoneId: string, rawDays: number): ShiftPlan | null {
  const days = clampDays(rawDays);
  const milestones = new Map(schedule.milestones.map((m) => [m.id, m]));
  const tasks = new Map(schedule.tasks.map((t) => [t.id, t]));
  const root = milestones.get(milestoneId);
  if (!root || !root.due) return null;

  const milestoneDue = new Map<string, string>();
  const taskDates = new Map<string, { start: string | null; due: string }>();
  const milestoneMoves = new Map<string, DateMove>();
  const taskMoves = new Map<string, TaskMove>();
  const blockedMilestones = new Map<string, string[]>();
  const blockedTasks = new Map<string, string[]>();
  for (const edge of schedule.milestoneDeps) blockedMilestones.set(edge.blocking, [...(blockedMilestones.get(edge.blocking) ?? []), edge.blocked]);
  for (const edge of schedule.taskDeps) blockedTasks.set(edge.blocking, [...(blockedTasks.get(edge.blocking) ?? []), edge.blocked]);
  const tasksIn = new Map<string, PlanTask[]>();
  for (const task of schedule.tasks) {
    if (task.milestoneId) tasksIn.set(task.milestoneId, [...(tasksIn.get(task.milestoneId) ?? []), task]);
  }

  const currentMilestoneDue = (id: string) => milestoneDue.get(id) ?? milestones.get(id)?.due ?? null;
  const currentTaskDue = (id: string) => taskDates.get(id)?.due ?? tasks.get(id)?.due ?? null;

  const queue: { kind: "milestone" | "task"; id: string }[] = [];

  const moveTask = (task: PlanTask, by: number, reason: DateMove["reason"], cause: string | null) => {
    if (task.closed || !task.due || by === 0) return;
    const before = taskDates.get(task.id) ?? { start: task.start, due: task.due };
    const next = { start: before.start ? shift(before.start, by) : null, due: shift(before.due, by) };
    taskDates.set(task.id, next);
    const existing = taskMoves.get(task.id);
    taskMoves.set(task.id, {
      id: task.id,
      name: task.title,
      projectId: task.projectId,
      from: existing?.from ?? task.due,
      to: next.due,
      startFrom: existing?.startFrom ?? task.start,
      startTo: next.start,
      reason: existing?.reason ?? reason,
      cause: existing?.cause ?? cause,
    });
    queue.push({ kind: "task", id: task.id });
  };

  const moveMilestone = (milestone: PlanMilestone, by: number, reason: DateMove["reason"], cause: string | null) => {
    const due = currentMilestoneDue(milestone.id);
    if (!due || by === 0) return;
    const next = shift(due, by);
    milestoneDue.set(milestone.id, next);
    const existing = milestoneMoves.get(milestone.id);
    milestoneMoves.set(milestone.id, {
      id: milestone.id,
      name: milestone.name,
      projectId: milestone.projectId,
      from: existing?.from ?? milestone.due!,
      to: next,
      reason: existing?.reason ?? reason,
      cause: existing?.cause ?? cause,
    });
    for (const task of tasksIn.get(milestone.id) ?? []) moveTask(task, by, "in_milestone", milestone.id);
    queue.push({ kind: "milestone", id: milestone.id });
  };

  moveMilestone(root, days, "shifted", null);

  // Push dependents forward until nothing more has to move. The database
  // refuses dependency cycles; the step cap is a second guard.
  let steps = 0;
  while (queue.length && steps++ < 10_000) {
    const item = queue.shift()!;
    if (item.kind === "milestone") {
      const due = currentMilestoneDue(item.id)!;
      for (const blockedId of blockedMilestones.get(item.id) ?? []) {
        const blocked = milestones.get(blockedId);
        const blockedDue = blocked && currentMilestoneDue(blockedId);
        if (!blocked || !blockedDue || blockedDue > due) continue;
        moveMilestone(blocked, daysBetween(blockedDue, due) + 1, "blocked_by", item.id);
      }
    } else {
      const due = currentTaskDue(item.id)!;
      for (const blockedId of blockedTasks.get(item.id) ?? []) {
        const blocked = tasks.get(blockedId);
        const blockedDue = blocked && currentTaskDue(blockedId);
        if (!blocked || !blockedDue || blockedDue > due) continue;
        moveTask(blocked, daysBetween(blockedDue, due) + 1, "blocked_by", item.id);
      }
    }
  }

  // Projects: the latest milestone or open-task date, before and after.
  const touched = new Set<string>();
  for (const move of milestoneMoves.values()) if (move.projectId) touched.add(move.projectId);
  for (const move of taskMoves.values()) if (move.projectId) touched.add(move.projectId);
  const projectMoves: ProjectMove[] = [];
  for (const project of schedule.projects) {
    if (!touched.has(project.id)) continue;
    let before: string | null = null;
    let after: string | null = null;
    for (const milestone of schedule.milestones) {
      if (milestone.projectId !== project.id) continue;
      before = later(before, milestone.due);
      after = later(after, currentMilestoneDue(milestone.id));
    }
    for (const task of schedule.tasks) {
      if (task.projectId !== project.id || task.closed) continue;
      before = later(before, task.due);
      after = later(after, currentTaskDue(task.id));
    }
    if (after && after !== before) {
      projectMoves.push({
        id: project.id,
        name: project.name,
        from: before,
        to: after,
        pastTarget: project.targetDate && after > project.targetDate ? project.targetDate : null,
      });
    }
  }

  const goals: GoalImpact[] = [];
  for (const move of projectMoves) {
    const programId = schedule.projects.find((project) => project.id === move.id)?.programId;
    if (!programId) continue;
    for (const goal of schedule.goals) {
      if (goal.programId === programId && goal.targetOn && move.to > goal.targetOn && !(move.from && move.from > goal.targetOn)) {
        goals.push({ id: goal.id, name: goal.name, targetOn: goal.targetOn, projectId: move.id, projectFinish: move.to });
      }
    }
  }

  const byDate = <T extends { to: string; name: string }>(a: T, b: T) => a.to.localeCompare(b.to) || a.name.localeCompare(b.name);
  return {
    milestoneId,
    days,
    milestones: [...milestoneMoves.values()].sort(byDate),
    tasks: [...taskMoves.values()].sort(byDate),
    projects: projectMoves.sort(byDate),
    goals: goals.sort((a, b) => a.targetOn.localeCompare(b.targetOn) || a.name.localeCompare(b.name)),
  };
}

/**
 * A short fingerprint of a plan's writes. The apply form carries the one the
 * person previewed; the action recomputes the plan from fresh data and
 * refuses when they differ, so nobody saves a schedule they did not see.
 */
export function planFingerprint(plan: ShiftPlan): string {
  const parts = [
    ...plan.milestones.map((move) => `m:${move.id}:${move.from}>${move.to}`),
    ...plan.tasks.map((move) => `t:${move.id}:${move.from}>${move.to}:${move.startFrom ?? ""}>${move.startTo ?? ""}`),
  ].sort();
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
