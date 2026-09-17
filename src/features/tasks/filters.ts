import { TASK_STATUSES } from "@/features/tasks/schemas";
import { addCalendarDays } from "@/lib/time";
import type { TaskStatus } from "@/types/entities";

/**
 * The filter set P0-TSK-08 requires: program, project, owner, status,
 * priority, due date, milestone, label and blocked state, plus free text.
 *
 * One definition, parsed from the URL and applied to the query, so My Work and
 * the board cannot drift into filtering differently — and so a filtered view
 * stays a shareable link rather than hidden client state.
 */

export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriorityFilter = (typeof TASK_PRIORITIES)[number];

export const DUE_WINDOWS = ["overdue", "today", "week", "month", "none"] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

export const DUE_WINDOW_LABELS: Record<DueWindow, string> = {
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  month: "Due this month",
  none: "No due date",
};

export interface TaskFilters {
  program?: string;
  project?: string;
  owner?: string;
  status?: TaskStatus;
  priority?: TaskPriorityFilter;
  due?: DueWindow;
  milestone?: string;
  label?: string;
  blocked?: "yes" | "no";
  q?: string;
}

/** Statuses treated as live work when no status filter is chosen. */
export const OPEN_STATUSES: TaskStatus[] = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
];

export type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

function uuid(value: string | string[] | undefined): string | undefined {
  const candidate = one(value);
  return candidate && UUID.test(candidate) ? candidate : undefined;
}

function member<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const candidate = one(value);
  return candidate && (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : undefined;
}

/**
 * Read filters from URL parameters.
 *
 * Anything unrecognised is dropped rather than rejected. These values arrive
 * from links people paste and edit by hand, and a stale or mistyped parameter
 * should cost you that one filter, not the page.
 */
export function parseTaskFilters(params: RawParams): TaskFilters {
  const filters: TaskFilters = {
    program: uuid(params.program),
    project: uuid(params.project),
    owner: uuid(params.owner),
    status: member(params.status, TASK_STATUSES),
    priority: member(params.priority, TASK_PRIORITIES),
    due: member(params.due, DUE_WINDOWS),
    milestone: uuid(params.milestone),
    label: uuid(params.label),
    blocked: member(params.blocked, ["yes", "no"] as const),
    q: one(params.q)?.slice(0, 200),
  };
  for (const key of Object.keys(filters) as (keyof TaskFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }
  return filters;
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return Object.keys(filters).length > 0;
}

export function countActiveFilters(filters: TaskFilters): number {
  return Object.keys(filters).length;
}

/**
 * Escape a user's text for a SQL LIKE pattern.
 *
 * Without this, typing `%` matches everything and `_` matches any character,
 * so the search quietly answers a different question than the one asked.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** Inclusive date bounds for a due-date window, in the viewer's zone. */
export function dueWindowRange(
  window: DueWindow,
  today: string,
): { from?: string; to?: string; isNull?: boolean } {
  const shift = (days: number) => addCalendarDays(today, days) ?? today;
  if (window === "none") return { isNull: true };
  if (window === "overdue") return { to: shift(-1) };
  if (window === "today") return { from: today, to: today };
  if (window === "week") return { from: today, to: shift(6) };
  return { from: today, to: shift(29) };
}

/**
 * The PostgREST select list. A label filter needs an inner join, which changes
 * the shape of the query rather than just its conditions.
 */
export function taskSelectFor(filters: TaskFilters, base: string): string {
  return filters.label ? `${base}, task_label!inner(label_id)` : base;
}

/** Minimal shape of the query builder these filters drive. */
export interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  neq(column: string, value: unknown): FilterableQuery;
  in(column: string, values: unknown[]): FilterableQuery;
  is(column: string, value: null): FilterableQuery;
  not(column: string, operator: string, value: unknown): FilterableQuery;
  gte(column: string, value: string): FilterableQuery;
  lte(column: string, value: string): FilterableQuery;
  ilike(column: string, pattern: string): FilterableQuery;
}

/**
 * Apply the filters to a task query.
 *
 * `today` is the viewer's date, passed in rather than read from the clock, so
 * the same request cannot straddle midnight between its query and its display.
 */
export function applyTaskFilters<Q extends FilterableQuery>(
  query: Q,
  filters: TaskFilters,
  today: string,
): Q {
  let q = query;

  if (filters.status) q = q.eq("status", filters.status) as Q;
  else q = q.in("status", OPEN_STATUSES) as Q;

  if (filters.program) q = q.eq("program_id", filters.program) as Q;
  if (filters.project) q = q.eq("project_id", filters.project) as Q;
  if (filters.owner) q = q.eq("assignee_id", filters.owner) as Q;
  if (filters.priority) q = q.eq("priority", filters.priority) as Q;
  if (filters.milestone) q = q.eq("milestone_id", filters.milestone) as Q;
  if (filters.label) q = q.eq("task_label.label_id", filters.label) as Q;

  if (filters.blocked === "yes") q = q.eq("status", "blocked") as Q;
  if (filters.blocked === "no") q = q.neq("status", "blocked") as Q;

  if (filters.due) {
    const range = dueWindowRange(filters.due, today);
    if (range.isNull) q = q.is("due_at", null) as Q;
    else {
      // An unscheduled task is not overdue, and not due this week either.
      q = q.not("due_at", "is", null) as Q;
      if (range.from) q = q.gte("due_at", range.from) as Q;
      if (range.to) q = q.lte("due_at", range.to) as Q;
    }
  }

  if (filters.q) q = q.ilike("title", `%${escapeLikePattern(filters.q)}%`) as Q;

  return q;
}
