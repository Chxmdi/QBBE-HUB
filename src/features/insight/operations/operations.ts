import { addCalendarDays } from "@/lib/time";
import { calendarDate, direction, todayIn, weekStarts, type Direction, type WeekBucket } from "../metrics";

/**
 * Operations analytics (V3-5): workload trends, overdue patterns and each
 * goal's trajectory, as tiles a dashboard can show. Pure: the page reads
 * tasks, people, outcome metrics and measurements under the viewer's RLS
 * (./operations.source.ts).
 */

export const OPS_WEEKS = 12;
const CLOSED = new Set(["completed", "cancelled"]);

export interface OpsTask {
  assigneeId: string | null;
  projectId: string | null;
  status: string;
  priority: string;
  createdAt: string;
  dueAt: string | null;
  completedAt: string | null;
}

const isOpen = (task: OpsTask) => !CLOSED.has(task.status);

/**
 * Open tasks at the end of each week: created by then and not finished by
 * then. A closed task with no finish time (cancelled, or completed before
 * completion times were kept) counts as open in earlier weeks and not this
 * one, which is the best the data allows until object_event records when it
 * closed.
 */
export function openLoadByWeek(tasks: OpsTask[], now: Date, timeZone?: string, weeks = OPS_WEEKS): WeekBucket[] {
  const today = todayIn(now, timeZone);
  return weekStarts(now, weeks, timeZone).map((start) => {
    const end = addCalendarDays(start, 6)!;
    const cutoff = end < today ? end : today;
    const count = tasks.filter((task) => {
      const created = calendarDate(task.createdAt, timeZone);
      if (!created || created > cutoff) return false;
      if (task.completedAt) {
        const done = calendarDate(task.completedAt, timeZone);
        return !!done && done > cutoff;
      }
      return cutoff === today ? !CLOSED.has(task.status) : true;
    }).length;
    return { start, count };
  });
}

export interface PersonLoad {
  personId: string;
  open: number;
  overdue: number;
  finishedLast28: number;
  /** Direction of this person's open load over the weeks. */
  trend: Direction;
  weekly: number[];
}

export function workloadByPerson(tasks: OpsTask[], now: Date, timeZone?: string): PersonLoad[] {
  const today = todayIn(now, timeZone);
  const since = addCalendarDays(today, -28)!;
  const byPerson = new Map<string, OpsTask[]>();
  for (const task of tasks) {
    if (task.assigneeId) byPerson.set(task.assigneeId, [...(byPerson.get(task.assigneeId) ?? []), task]);
  }
  return [...byPerson.entries()]
    .map(([personId, mine]) => {
      const weekly = openLoadByWeek(mine, now, timeZone).map((bucket) => bucket.count);
      return {
        personId,
        open: mine.filter(isOpen).length,
        overdue: mine.filter((task) => isOpen(task) && !!task.dueAt && task.dueAt < today).length,
        finishedLast28: mine.filter((task) => (task.completedAt ? calendarDate(task.completedAt, timeZone) ?? "" : "") >= since).length,
        trend: direction(weekly),
        weekly,
      };
    })
    .filter((load) => load.open + load.finishedLast28 > 0)
    .sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.personId.localeCompare(b.personId));
}

export const LATENESS_BANDS = ["days1to7", "days8to30", "days31plus"] as const;
export type LatenessBand = (typeof LATENESS_BANDS)[number];

export interface OverduePatterns {
  total: number;
  byLateness: Record<LatenessBand, number>;
  byPriority: { priority: string; count: number }[];
  /** Projects with the most overdue tasks, most first (null: no project). */
  byProject: { projectId: string | null; count: number }[];
  /** Tasks finished in the last 12 weeks, and how many of those finished after their due date. */
  finished: number;
  finishedLate: number;
  /** Per week: tasks whose due date fell that week and were not finished by it. */
  slippedByWeek: WeekBucket[];
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

export function overduePatterns(tasks: OpsTask[], now: Date, timeZone?: string): OverduePatterns {
  const today = todayIn(now, timeZone);
  const overdue = tasks.filter((task) => isOpen(task) && !!task.dueAt && task.dueAt < today);
  const byLateness: Record<LatenessBand, number> = { days1to7: 0, days8to30: 0, days31plus: 0 };
  for (const task of overdue) {
    const late = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${task.dueAt}T00:00:00Z`)) / 86_400_000);
    byLateness[late <= 7 ? "days1to7" : late <= 30 ? "days8to30" : "days31plus"]++;
  }
  const count = <K>(key: (task: OpsTask) => K) => {
    const map = new Map<K, number>();
    for (const task of overdue) map.set(key(task), (map.get(key(task)) ?? 0) + 1);
    return map;
  };
  const starts = weekStarts(now, OPS_WEEKS, timeZone);
  const windowStart = starts[0];
  const finishedRecently = tasks.filter((task) => {
    const done = task.completedAt ? calendarDate(task.completedAt, timeZone) : null;
    return !!done && done >= windowStart;
  });
  const slippedByWeek = starts.map((start) => {
    const end = addCalendarDays(start, 6)!;
    const count = tasks.filter((task) => {
      if (!task.dueAt || task.dueAt < start || task.dueAt > end || task.dueAt >= today || task.status === "cancelled") return false;
      const done = task.completedAt ? calendarDate(task.completedAt, timeZone) : null;
      return !done || done > task.dueAt;
    }).length;
    return { start, count };
  });
  return {
    total: overdue.length,
    byLateness,
    byPriority: [...count((task) => task.priority)]
      .map(([priority, n]) => ({ priority, count: n }))
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)),
    byProject: [...count((task) => task.projectId)]
      .map(([projectId, n]) => ({ projectId, count: n }))
      .sort((a, b) => b.count - a.count || String(a.projectId).localeCompare(String(b.projectId)))
      .slice(0, 5),
    finished: finishedRecently.length,
    finishedLate: finishedRecently.filter((task) => {
      const done = calendarDate(task.completedAt!, timeZone);
      return !!task.dueAt && !!done && done > task.dueAt;
    }).length,
    slippedByWeek,
  };
}

export interface GoalMetric {
  id: string;
  name: string;
  unit: string;
  direction: "increase" | "decrease";
  baseline: number | null;
  baselineOn: string | null;
  target: number | null;
  targetOn: string | null;
}

export interface Measurement {
  metricId: string;
  measuredOn: string;
  value: number;
}

export type GoalStatus = "ahead" | "on_track" | "behind" | "reached" | "no_data" | "no_target";

export interface GoalTrajectory {
  metric: GoalMetric;
  latest: { value: number; on: string } | null;
  /** Where the straight line from baseline to target says it should be on the latest date. */
  expected: number | null;
  /** The recent pace carried on to the target date (at least two measurements). */
  projected: number | null;
  status: GoalStatus;
  /** Measurements oldest first, for a sparkline. */
  points: { on: string; value: number }[];
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Least-squares slope and intercept of value over day number. */
function fit(points: { on: string; value: number }[]): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => dayNumber(p.on));
  const ys = points.map((p) => p.value);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * A goal's trajectory: compared with the straight line from its baseline to
 * its target, and projected from the recent pace. Within 5% of the planned
 * change counts as on track.
 */
export function goalTrajectory(metric: GoalMetric, measurements: Measurement[]): GoalTrajectory {
  const points = measurements
    .filter((m) => m.metricId === metric.id)
    .map((m) => ({ on: m.measuredOn, value: Number(m.value) }))
    .sort((a, b) => a.on.localeCompare(b.on));
  const latest = points.length ? { value: points.at(-1)!.value, on: points.at(-1)!.on } : null;
  const recent = points.slice(-6);
  const line = fit(recent);
  const projected = line && metric.targetOn ? line.slope * dayNumber(metric.targetOn) + line.intercept : null;
  const base = { metric, latest, projected, points };
  if (metric.target === null || metric.targetOn === null || metric.baseline === null || metric.baselineOn === null) {
    return { ...base, expected: null, status: latest ? "no_target" : "no_data" };
  }
  if (!latest) return { ...base, expected: null, status: "no_data" };
  const up = metric.direction === "increase";
  if (up ? latest.value >= metric.target : latest.value <= metric.target) return { ...base, expected: metric.target, status: "reached" };
  const span = dayNumber(metric.targetOn) - dayNumber(metric.baselineOn);
  const progress = span <= 0 ? 1 : Math.min(Math.max((dayNumber(latest.on) - dayNumber(metric.baselineOn)) / span, 0), 1);
  const expected = metric.baseline + (metric.target - metric.baseline) * progress;
  const tolerance = Math.abs(metric.target - metric.baseline) * 0.05;
  const gap = up ? latest.value - expected : expected - latest.value;
  const status: GoalStatus = gap > tolerance ? "ahead" : gap < -tolerance ? "behind" : "on_track";
  return { ...base, expected, status };
}
