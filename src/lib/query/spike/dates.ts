// W0-8 spike: resolve date values ("today", "this_week", a fixed date) to an
// inclusive range of calendar days in the viewer's time zone. Weeks start on
// Monday, as in Quebec. Pure functions, so the edge cases are unit-tested.

import type { DateValue, RelativeDate } from "./spec";

export interface DayRange {
  /** First day, YYYY-MM-DD, inclusive. */
  start: string;
  /** Last day, YYYY-MM-DD, inclusive. */
  end: string;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day `now` falls on in `timeZone`. */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function relativeRange(rel: RelativeDate, today: string): DayRange {
  switch (rel) {
    case "today":
      return { start: today, end: today };
    case "yesterday":
      return { start: addDays(today, -1), end: addDays(today, -1) };
    case "tomorrow":
      return { start: addDays(today, 1), end: addDays(today, 1) };
    case "this_week": {
      const monday = mondayOf(today);
      return { start: monday, end: addDays(monday, 6) };
    }
    case "last_week": {
      const monday = addDays(mondayOf(today), -7);
      return { start: monday, end: addDays(monday, 6) };
    }
    case "next_week": {
      const monday = addDays(mondayOf(today), 7);
      return { start: monday, end: addDays(monday, 6) };
    }
    case "this_month": {
      const first = `${today.slice(0, 7)}-01`;
      const d = new Date(`${first}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      return { start: first, end: d.toISOString().slice(0, 10) };
    }
    case "last_7_days":
      return { start: addDays(today, -6), end: today };
    case "next_7_days":
      return { start: today, end: addDays(today, 6) };
  }
}

export function resolveDate(value: DateValue, today: string): DayRange {
  if ("date" in value) return { start: value.date, end: value.date };
  return relativeRange(value.relative, today);
}

export { addDays };
