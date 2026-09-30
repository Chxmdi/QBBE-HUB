/**
 * A project's calculated health and progress (M19a, epic #199), by fixed
 * rules from its own records. The health somebody reports in a status update
 * stays theirs; this is shown beside it, with the reasons, so a gap between
 * the two is visible rather than argued about.
 *
 * Health: the worst signal wins.
 *   off track   past its target date and not completed
 *               two or more milestones overdue
 *               a quarter or more of its open tasks overdue (at least two)
 *   at risk     one milestone overdue
 *               any open task overdue
 *               any task blocked
 *               an open risk rated high likelihood and high impact
 *               target within 14 days with progress under 75%
 *   on track    none of the above
 *
 * Progress: completed tasks over all tasks that are not cancelled; with no
 * tasks, completed milestones over all milestones; with neither, unknown.
 */

export type CalculatedHealth = "on_track" | "at_risk" | "off_track" | "completed";

export interface HealthInput {
  /** YYYY-MM-DD in the organization's zone. */
  today: string;
  project: { target_date: string | null; completed_at: string | null };
  tasks: { status: string; due_at: string | null }[];
  milestones: { due_date: string | null; completed_at: string | null; status: string | null }[];
  risks: { likelihood: string; impact: string; status: string }[];
}

export type HealthReason =
  | { rule: "target_passed"; level: "off_track"; date: string }
  | { rule: "milestones_overdue"; level: "off_track" | "at_risk"; count: number }
  | { rule: "tasks_overdue"; level: "off_track" | "at_risk"; count: number; open: number }
  | { rule: "tasks_blocked"; level: "at_risk"; count: number }
  | { rule: "severe_risks"; level: "at_risk"; count: number }
  | { rule: "deadline_pressure"; level: "at_risk"; days: number; percent: number };

export interface Progress {
  tasks: { done: number; total: number };
  milestones: { done: number; total: number };
  /** 0 to 100, or null when there is nothing to count. */
  percent: number | null;
}

export interface ProjectHealth {
  health: CalculatedHealth;
  reasons: HealthReason[];
  progress: Progress;
}

const OPEN = new Set(["not_started", "ready", "in_progress", "waiting", "blocked", "in_review"]);
const PRESSURE_DAYS = 14;
const PRESSURE_PERCENT = 75;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function calculateProgress(input: Pick<HealthInput, "tasks" | "milestones">): Progress {
  const countable = input.tasks.filter((task) => task.status !== "cancelled");
  const tasks = { done: countable.filter((task) => task.status === "completed").length, total: countable.length };
  const milestones = {
    done: input.milestones.filter((milestone) => milestone.completed_at || milestone.status === "completed").length,
    total: input.milestones.length,
  };
  const basis = tasks.total > 0 ? tasks : milestones;
  return { tasks, milestones, percent: basis.total > 0 ? Math.round((100 * basis.done) / basis.total) : null };
}

export function calculateHealth(input: HealthInput): ProjectHealth {
  const progress = calculateProgress(input);
  if (input.project.completed_at) return { health: "completed", reasons: [], progress };

  const reasons: HealthReason[] = [];
  const { today } = input;
  const target = input.project.target_date?.slice(0, 10) ?? null;

  if (target && target < today) reasons.push({ rule: "target_passed", level: "off_track", date: target });

  const lateMilestones = input.milestones.filter(
    (milestone) =>
      milestone.due_date &&
      milestone.due_date.slice(0, 10) < today &&
      !milestone.completed_at &&
      milestone.status !== "completed",
  ).length;
  if (lateMilestones >= 2) reasons.push({ rule: "milestones_overdue", level: "off_track", count: lateMilestones });
  else if (lateMilestones === 1) reasons.push({ rule: "milestones_overdue", level: "at_risk", count: 1 });

  const open = input.tasks.filter((task) => OPEN.has(task.status));
  const lateTasks = open.filter((task) => task.due_at && task.due_at.slice(0, 10) < today).length;
  if (lateTasks >= 2 && lateTasks / open.length >= 0.25) {
    reasons.push({ rule: "tasks_overdue", level: "off_track", count: lateTasks, open: open.length });
  } else if (lateTasks > 0) {
    reasons.push({ rule: "tasks_overdue", level: "at_risk", count: lateTasks, open: open.length });
  }

  const blocked = open.filter((task) => task.status === "blocked").length;
  if (blocked > 0) reasons.push({ rule: "tasks_blocked", level: "at_risk", count: blocked });

  const severe = input.risks.filter(
    (risk) => (risk.status === "open" || risk.status === "mitigating") && risk.likelihood === "high" && risk.impact === "high",
  ).length;
  if (severe > 0) reasons.push({ rule: "severe_risks", level: "at_risk", count: severe });

  if (target && target >= today && progress.percent !== null) {
    const days = daysBetween(today, target);
    if (days <= PRESSURE_DAYS && progress.percent < PRESSURE_PERCENT) {
      reasons.push({ rule: "deadline_pressure", level: "at_risk", days, percent: progress.percent });
    }
  }

  const order = { off_track: 0, at_risk: 1 } as const;
  reasons.sort((a, b) => order[a.level] - order[b.level]);
  const health: CalculatedHealth = reasons.some((reason) => reason.level === "off_track")
    ? "off_track"
    : reasons.length
      ? "at_risk"
      : "on_track";
  return { health, reasons, progress };
}
