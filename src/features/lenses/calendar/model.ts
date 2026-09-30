/**
 * The calendar lens (V1-1) as pure functions: the date window for a view, the
 * spec that asks the engine for rows in it, and rows turned into the calendar
 * items the existing /calendar components draw.
 */

import type { LensNode, LensSpec } from "@/lib/query/spec";
import type { LensRow } from "@/lib/query/run";

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday, as the /calendar week
}

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** The first and last calendar day a view shows around `anchor`. */
export function calendarRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = addDays(anchor, -weekday(anchor));
    return { from, to: addDays(from, 6) };
  }
  if (view === "agenda") return { from: anchor, to: addDays(anchor, 29) };
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  return { from: addDays(first, -weekday(first)), to: addDays(last, 6 - weekday(last)) };
}

/** The days of a month grid, whole weeks, Sunday first. */
export function monthDays(anchor: string): string[] {
  const { from, to } = calendarRange("month", anchor);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The anchor of the previous or next window. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === "week") return addDays(anchor, 7 * direction);
  if (view === "agenda") return addDays(anchor, 30 * direction);
  const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + direction);
  return d.toISOString().slice(0, 10);
}

/** The lens's spec, narrowed to rows whose date falls in the window. */
export function calendarSpec(base: Partial<LensSpec> & { type: string }, dateProperty: string, range: { from: string; to: string }): LensSpec {
  const where = base.where;
  const conditions: LensNode[] = where ? ("and" in where ? [...where.and] : [where]) : [];
  conditions.push({ property: dateProperty, operator: "between", value: { from: { date: range.from }, to: { date: range.to } } });
  const select = [...new Set([...(base.select ?? []), dateProperty, ...(base.type === "task" ? ["status", "assignee"] : [])])].slice(0, 30);
  return {
    version: 1,
    type: base.type,
    where: { and: conditions },
    sort: [{ property: dateProperty, direction: "asc" }, { property: "title", direction: "asc" }],
    select,
    limit: 1000,
  };
}

export interface LensCalendarItem {
  id: string;
  recordId: string;
  date: Date;
  day: string;
  label: string;
  kind: "task" | "milestone";
  href: string;
  timed: false;
  owner: string | null;
  done: boolean;
  reschedulableDate: string | null;
}

/**
 * Rows as calendar items. A task can be moved from the calendar only when its
 * date is the due date and the viewer may edit it (lens_editable), so no one
 * is shown a control that would fail.
 */
export function rowsToItems(
  rows: LensRow[],
  type: string,
  dateProperty: string,
  editable: ReadonlySet<string>,
): LensCalendarItem[] {
  const items: LensCalendarItem[] = [];
  for (const row of rows) {
    const raw = row.values[dateProperty];
    if (typeof raw !== "string") continue;
    const day = raw.slice(0, 10);
    if (!isIsoDay(day)) continue;
    const assignee = row.values.assignee;
    items.push({
      id: `${type}-${row.id}`,
      recordId: row.id,
      // Noon UTC, so the day never shifts when the browser formats it.
      date: new Date(`${day}T12:00:00Z`),
      day,
      label: row.title,
      kind: type === "task" ? "task" : "milestone",
      href: type === "task" ? `/my-work?task=${row.id}` : `/projects/${row.id}`,
      timed: false,
      owner: assignee && typeof assignee === "object" && "label" in assignee ? assignee.label : null,
      done: row.values.status === "completed",
      reschedulableDate: type === "task" && dateProperty === "due" && editable.has(row.id) ? day : null,
    });
  }
  return items;
}
