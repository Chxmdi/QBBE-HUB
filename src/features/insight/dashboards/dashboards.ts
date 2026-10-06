import { addCalendarDays } from "@/lib/time";
import { bucketByWeek, calendarDate, todayIn, weekStarts, type WeekBucket } from "../metrics";

/**
 * Advanced dashboards (V2-5): cross-space totals, trends over time and
 * dashboards per role. Pure: the page loads rows under the viewer's RLS
 * (./dashboards.source.ts) and these functions turn them into tiles.
 *
 * "Space" means a programme until S2's spaces exist; the totals table groups
 * by programme and gathers everything outside one under "No programme".
 */

export const TREND_WEEKS = 12;

export const statTileKeys = [
  "openTasks",
  "overdueTasks",
  "completedLast30",
  "activeProjects",
  "openRisks",
  "upcomingEvents",
  "billsOutstanding",
  "invoicesOutstanding",
  "giftsThisYear",
  "measurementsLast90",
] as const;
export type StatTileKey = (typeof statTileKeys)[number];

export const trendKeys = ["tasksCompleted", "tasksCreated", "activity", "giftsReceived"] as const;
export type TrendKey = (typeof trendKeys)[number];

export interface DashboardTemplate {
  key: "executive" | "finance" | "programs";
  stats: StatTileKey[];
  trends: TrendKey[];
  /** Whether the per-programme totals table is shown. */
  spaceTotals: boolean;
}

export const dashboardTemplates: readonly DashboardTemplate[] = [
  {
    key: "executive",
    stats: ["openTasks", "overdueTasks", "completedLast30", "activeProjects", "openRisks", "upcomingEvents"],
    trends: ["tasksCompleted", "activity"],
    spaceTotals: true,
  },
  {
    key: "finance",
    stats: ["billsOutstanding", "invoicesOutstanding", "giftsThisYear"],
    trends: ["giftsReceived"],
    spaceTotals: false,
  },
  {
    key: "programs",
    stats: ["openTasks", "overdueTasks", "upcomingEvents", "measurementsLast90"],
    trends: ["tasksCompleted", "tasksCreated"],
    spaceTotals: true,
  },
];

export function templateFor(key: string | undefined): DashboardTemplate {
  return dashboardTemplates.find((template) => template.key === key) ?? dashboardTemplates[0];
}

/** Which sources a template needs, so a page loads nothing it will not show. */
export function sourcesFor(template: DashboardTemplate): Set<DashboardSource> {
  const needs = new Set<DashboardSource>();
  const stat: Record<StatTileKey, DashboardSource[]> = {
    openTasks: ["tasks"],
    overdueTasks: ["tasks"],
    completedLast30: ["tasks"],
    activeProjects: ["projects"],
    openRisks: ["risks"],
    upcomingEvents: ["events"],
    billsOutstanding: ["bills"],
    invoicesOutstanding: ["invoices"],
    giftsThisYear: ["gifts"],
    measurementsLast90: ["measurements"],
  };
  const trend: Record<TrendKey, DashboardSource[]> = {
    tasksCompleted: ["tasks"],
    tasksCreated: ["tasks"],
    activity: ["activity"],
    giftsReceived: ["gifts"],
  };
  for (const key of template.stats) for (const source of stat[key]) needs.add(source);
  for (const key of template.trends) for (const source of trend[key]) needs.add(source);
  if (template.spaceTotals) for (const source of ["programs", "projects", "tasks", "events"] as const) needs.add(source);
  return needs;
}

export type DashboardSource =
  | "programs"
  | "projects"
  | "tasks"
  | "risks"
  | "events"
  | "activity"
  | "bills"
  | "invoices"
  | "gifts"
  | "measurements";

export interface DashboardRows {
  programs: { id: string; name: string }[];
  projects: { id: string; program_id: string | null }[];
  tasks: {
    status: string;
    due_at: string | null;
    completed_at: string | null;
    created_at: string;
    program_id: string | null;
    project_id: string | null;
  }[];
  risks: { status: string }[];
  events: { starts_at: string; program_id: string | null; project_id: string | null }[];
  activity: { created_at: string }[];
  bills: { total_cents: number; paid_cents: number; status: string }[];
  invoices: { total_cents: number; paid_cents: number; status: string }[];
  gifts: { amount_cents: number; received_on: string; status: string }[];
  measurements: { measured_on: string }[];
}

export const CLOSED_TASK_STATUSES = new Set(["completed", "cancelled"]);

export type StatValue = { kind: "count"; value: number } | { kind: "money"; cents: number };

export interface SpaceTotal {
  programId: string | null;
  name: string | null;
  projects: number;
  openTasks: number;
  overdueTasks: number;
  completedLast30: number;
  upcomingEvents: number;
}

export interface DashboardData {
  stats: Partial<Record<StatTileKey, StatValue>>;
  trends: Partial<Record<TrendKey, WeekBucket[]>>;
  spaceTotals: SpaceTotal[];
}

const isOpen = (task: DashboardRows["tasks"][number]) => !CLOSED_TASK_STATUSES.has(task.status);
const outstanding = (rows: { total_cents: number; paid_cents: number; status: string }[]) =>
  rows
    .filter((row) => row.status === "posted")
    .reduce((sum, row) => sum + Math.max(Number(row.total_cents) - Number(row.paid_cents), 0), 0);

export function buildDashboard(
  template: DashboardTemplate,
  rows: DashboardRows,
  now: Date,
  timeZone?: string,
): DashboardData {
  const today = todayIn(now, timeZone);
  const since30 = addCalendarDays(today, -30)!;
  const since90 = addCalendarDays(today, -90)!;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const dateOf = (value: string | null) => (value ? calendarDate(value, timeZone) : null);
  const isOverdue = (task: DashboardRows["tasks"][number]) => isOpen(task) && !!task.due_at && task.due_at < today;
  const isRecentlyDone = (task: DashboardRows["tasks"][number]) => (dateOf(task.completed_at) ?? "") >= since30;
  const isUpcoming = (event: DashboardRows["events"][number]) => (dateOf(event.starts_at) ?? "") >= today;
  const recordedGifts = rows.gifts.filter((gift) => gift.status === "recorded");

  const all: Record<StatTileKey, () => StatValue> = {
    openTasks: () => ({ kind: "count", value: rows.tasks.filter(isOpen).length }),
    overdueTasks: () => ({ kind: "count", value: rows.tasks.filter(isOverdue).length }),
    completedLast30: () => ({ kind: "count", value: rows.tasks.filter(isRecentlyDone).length }),
    activeProjects: () => ({ kind: "count", value: rows.projects.length }),
    openRisks: () => ({ kind: "count", value: rows.risks.filter((risk) => risk.status !== "closed").length }),
    upcomingEvents: () => ({ kind: "count", value: rows.events.filter(isUpcoming).length }),
    billsOutstanding: () => ({ kind: "money", cents: outstanding(rows.bills) }),
    invoicesOutstanding: () => ({ kind: "money", cents: outstanding(rows.invoices) }),
    giftsThisYear: () => ({
      kind: "money",
      cents: recordedGifts.filter((gift) => gift.received_on >= yearStart).reduce((sum, gift) => sum + Number(gift.amount_cents), 0),
    }),
    measurementsLast90: () => ({
      kind: "count",
      value: rows.measurements.filter((m) => m.measured_on >= since90).length,
    }),
  };

  const starts = weekStarts(now, TREND_WEEKS, timeZone);
  const trendOf: Record<TrendKey, () => WeekBucket[]> = {
    tasksCompleted: () => bucketByWeek(rows.tasks, starts, (task) => task.completed_at, timeZone),
    tasksCreated: () => bucketByWeek(rows.tasks, starts, (task) => task.created_at, timeZone),
    activity: () => bucketByWeek(rows.activity, starts, (event) => event.created_at, timeZone),
    // Money per week, in whole dollars so the axis reads plainly.
    giftsReceived: () =>
      bucketByWeek(recordedGifts, starts, (gift) => gift.received_on, timeZone, (gift) => Math.round(Number(gift.amount_cents) / 100)),
  };

  return {
    stats: Object.fromEntries(template.stats.map((key) => [key, all[key]()])),
    trends: Object.fromEntries(template.trends.map((key) => [key, trendOf[key]()])),
    spaceTotals: template.spaceTotals ? spaceTotals(rows, isOverdue, isRecentlyDone, isUpcoming) : [],
  };
}

function spaceTotals(
  rows: DashboardRows,
  isOverdue: (task: DashboardRows["tasks"][number]) => boolean,
  isRecentlyDone: (task: DashboardRows["tasks"][number]) => boolean,
  isUpcoming: (event: DashboardRows["events"][number]) => boolean,
): SpaceTotal[] {
  const projectProgram = new Map(rows.projects.map((project) => [project.id, project.program_id]));
  // A task or event belongs to its own programme, else its project's.
  const programOf = (row: { program_id: string | null; project_id: string | null }) =>
    row.program_id ?? (row.project_id ? projectProgram.get(row.project_id) ?? null : null);
  const totals = new Map<string | null, SpaceTotal>();
  const blank = (programId: string | null, name: string | null): SpaceTotal => ({
    programId, name, projects: 0, openTasks: 0, overdueTasks: 0, completedLast30: 0, upcomingEvents: 0,
  });
  for (const program of rows.programs) totals.set(program.id, blank(program.id, program.name));
  // Rows in a programme the viewer cannot read still count, under "No programme",
  // so a total never leaks a programme's name but never silently drops work either.
  const bucket = (programId: string | null) => totals.get(programId && totals.has(programId) ? programId : null)
    ?? totals.set(null, blank(null, null)).get(null)!;
  for (const project of rows.projects) bucket(project.program_id).projects++;
  for (const task of rows.tasks) {
    const total = bucket(programOf(task));
    if (!CLOSED_TASK_STATUSES.has(task.status)) total.openTasks++;
    if (isOverdue(task)) total.overdueTasks++;
    if (isRecentlyDone(task)) total.completedLast30++;
  }
  for (const event of rows.events) if (isUpcoming(event)) bucket(programOf(event)).upcomingEvents++;
  return [...totals.values()]
    .filter((total) => total.programId !== null || total.projects + total.openTasks + total.completedLast30 + total.upcomingEvents > 0)
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name)));
}
