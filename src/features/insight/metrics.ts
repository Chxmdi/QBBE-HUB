import { addCalendarDays, calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";

/**
 * Time bucketing shared by the Insight dashboards and analytics. Weeks run
 * Monday to Sunday in the organization's zone, as the Hub's calendar shows
 * them, and are identified by their Monday's calendar date (YYYY-MM-DD).
 */

export interface WeekBucket {
  /** Monday, YYYY-MM-DD. */
  start: string;
  count: number;
}

/** Today's calendar date in a zone. */
export function todayIn(now: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
}

/** The Monday on or before a calendar date. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7))!;
}

/** The last `weeks` Mondays, oldest first, ending with this week's. */
export function weekStarts(now: Date, weeks: number, timeZone?: string): string[] {
  const current = mondayOf(todayIn(now, timeZone));
  return Array.from({ length: weeks }, (_, index) => addCalendarDays(current, -7 * (weeks - 1 - index))!);
}

/** A stored value (a date or an instant) as a calendar date in the zone. */
export function calendarDate(value: string, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return calendarDateInZone(instant, timeZone);
}

/**
 * Counts (or sums `weight`) per week. Values outside the weeks are ignored;
 * a missing value counts nowhere.
 */
export function bucketByWeek<T>(
  items: T[],
  starts: string[],
  when: (item: T) => string | null | undefined,
  timeZone?: string,
  weight: (item: T) => number = () => 1,
): WeekBucket[] {
  const index = new Map(starts.map((start, position) => [start, position]));
  const counts = starts.map(() => 0);
  for (const item of items) {
    const value = when(item);
    if (!value) continue;
    const date = calendarDate(value, timeZone);
    if (!date) continue;
    const position = index.get(mondayOf(date));
    if (position !== undefined) counts[position] += weight(item);
  }
  return starts.map((start, position) => ({ start, count: counts[position] }));
}

export type Direction = "up" | "down" | "flat";

/**
 * Whether the recent half of a series is above or below the earlier half,
 * with a 10% dead band so noise does not read as a trend.
 */
export function direction(values: number[]): Direction {
  if (values.length < 2) return "flat";
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half).reduce((sum, v) => sum + v, 0) / half;
  const recent = values.slice(-half).reduce((sum, v) => sum + v, 0) / half;
  if (earlier === 0 && recent === 0) return "flat";
  const change = (recent - earlier) / Math.max(earlier, 1);
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}
