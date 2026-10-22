/**
 * Where the unified calendar puts things, as pure functions in one zone.
 *
 * The server runs in UTC, so date-fns on a `Date` (startOfWeek, isSameDay,
 * format) answers in UTC: a meeting at 21:00 in Toronto landed on the next
 * day at 1:00 AM, the week's window started four or five hours late, and
 * "today" moved to tomorrow every evening. Days here are YYYY-MM-DD strings,
 * as the calendar lens already uses; only timed records (`timestamptz`) are
 * converted, and always into the workspace's zone.
 */

import { calendarRange, monthDays } from "@/features/lenses/calendar/model";
import type { Locale } from "@/lib/i18n/config";
import { isCalendarDate } from "@/lib/schema";
import {
  addCalendarDays,
  calendarDateInZone,
  formatInZone,
  startOfDayInstant,
} from "@/lib/time";

export type CalendarGridView = "week" | "month";

export interface CalendarWindow {
  from: string;
  to: string;
  days: string[];
}

/** The days a week or month view shows around `anchor`, Sunday first. */
export function calendarWindow(view: CalendarGridView, anchor: string): CalendarWindow {
  const { from, to } = calendarRange(view, anchor);
  if (view === "month") return { from, to, days: monthDays(anchor) };
  const days: string[] = [];
  for (let d: string | null = from; d && d <= to; d = addCalendarDays(d, 1)) days.push(d);
  return { from, to, days };
}

/**
 * The instants that bound the window in `timeZone`, end exclusive, for
 * filtering `timestamptz` columns. The end is the start of the day after the
 * last one, so the last day's evening is included and DST is honoured.
 */
export function windowInstants(
  window: Pick<CalendarWindow, "from" | "to">,
  timeZone: string,
): { startIso: string; endIso: string } {
  const start = startOfDayInstant(window.from, timeZone);
  const end = startOfDayInstant(addCalendarDays(window.to, 1) ?? window.to, timeZone);
  if (!start || !end) throw new Error(`Calendar window ${window.from}..${window.to} is not a range of days`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** The workspace day a timed record falls on. */
export function timedItemDay(iso: string, timeZone: string): string | null {
  return calendarDateInZone(iso, timeZone);
}

/** A timed record's clock time in the workspace zone ("9:00 p.m.", "21 h 00"). */
export function timeOfDayLabel(iso: string, timeZone: string, locale: Locale): string {
  return formatInZone(iso, timeZone, { hour: "numeric", minute: "2-digit" }, locale);
}

/** The day the calendar opens on: the requested one, else today in the zone. */
export function anchorDay(
  requested: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): string {
  if (requested && isCalendarDate(requested)) return requested;
  return calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
}

/**
 * A calendar day as a local-midnight `Date`, only for date-fns labels
 * ("Fri", "Oct 23"). It formats back as the same day in any process zone.
 */
export function dayAsLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}
