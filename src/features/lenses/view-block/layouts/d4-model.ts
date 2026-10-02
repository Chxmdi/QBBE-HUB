import type { LensRow, LensValue } from "@/lib/query/run";
import { calendarDateInZone } from "@/lib/time";

/**
 * Wave 2 unit D4: the timeline, gallery and feed layouts as pure functions.
 * Every function keeps the rows in the order the engine returned them, so a
 * layout shows exactly the rows, in exactly the order, the table would.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A row value as a calendar day (YYYY-MM-DD) in the reader's zone, or null. */
export function dayOf(value: LensValue | undefined, timestamp: boolean, timeZone: string): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!timestamp) {
    const day = value.slice(0, 10);
    return ISO_DAY.test(day) ? day : null;
  }
  return calendarDateInZone(value, timeZone);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Which of a row's dates are missing: none, one of them, or both. */
export type Missing = "none" | "start" | "end" | "both";

export interface TimelineItem {
  row: LensRow;
  /** The first day the bar covers; null when the row has no date at all. */
  start: string | null;
  /** The last day the bar covers (same as start for a one-day bar). */
  end: string | null;
  missing: Missing;
}

export interface DateField {
  key: string | null;
  timestamp: boolean;
}

/**
 * One item per row, in the rows' order. A row with only one date is a
 * one-day bar on it; a row whose end is before its start covers the days
 * between them; a row with no dates stays in its place, without a bar.
 */
export function timelineItems(rows: readonly LensRow[], start: DateField, end: DateField, timeZone: string): TimelineItem[] {
  return rows.map((row) => {
    const s = start.key ? dayOf(row.values[start.key], start.timestamp, timeZone) : null;
    const e = end.key ? dayOf(row.values[end.key], end.timestamp, timeZone) : null;
    if (s && e) return { row, start: s <= e ? s : e, end: s <= e ? e : s, missing: "none" };
    if (s) return { row, start: s, end: s, missing: end.key ? "end" : "none" };
    if (e) return { row, start: e, end: e, missing: "start" };
    return { row, start: null, end: null, missing: "both" };
  });
}

export interface Span {
  from: string;
  to: string;
  /** Days shown, inclusive of both ends. */
  days: number;
}

/** The days the timeline shows: every bar, with a day of room on each side; null with no bars. */
export function timelineSpan(items: readonly TimelineItem[]): Span | null {
  const placed = items.filter((i): i is TimelineItem & { start: string; end: string } => Boolean(i.start && i.end));
  if (!placed.length) return null;
  const from = addDays(placed.reduce((m, i) => (i.start < m ? i.start : m), placed[0].start), -1);
  const to = addDays(placed.reduce((m, i) => (i.end > m ? i.end : m), placed[0].end), 1);
  return { from, to, days: daysBetween(from, to) + 1 };
}

/** Where a bar sits, as percentages of the track, so it scales to any width. */
export function placeBar(span: Span, start: string, end: string): { left: number; width: number } {
  const left = (daysBetween(span.from, start) / span.days) * 100;
  const width = ((daysBetween(start, end) + 1) / span.days) * 100;
  return { left: round(left), width: round(width) };
}

/** The first day of each month inside the span (and the span's first day), with its position. */
export function monthTicks(span: Span): { day: string; left: number }[] {
  const ticks = [{ day: span.from, left: 0 }];
  let day = `${span.from.slice(0, 7)}-01`;
  for (;;) {
    const [y, m] = day.split("-").map(Number);
    day = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    if (day > span.to) break;
    ticks.push({ day, left: round((daysBetween(span.from, day) / span.days) * 100) });
  }
  return ticks;
}

/** Whether a day falls inside the span, for the "today" line. */
export function inSpan(span: Span, day: string): boolean {
  return day >= span.from && day <= span.to;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Keyboard movement in a list of rows: arrows step, Home and End jump,
 * Page Up and Page Down move ten. Returns null for other keys.
 */
export function nextIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  const clamp = (n: number) => Math.min(count - 1, Math.max(0, n));
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return clamp(index + 1);
    case "ArrowUp":
    case "ArrowLeft":
      return clamp(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return clamp(index + 10);
    case "PageUp":
      return clamp(index - 10);
    default:
      return null;
  }
}

/** Feed entries grouped by consecutive day of their date, keeping the rows' order; undated rows get day "". */
export function feedGroups(rows: readonly LensRow[], date: DateField, timeZone: string): { day: string; rows: LensRow[] }[] {
  const out: { day: string; rows: LensRow[] }[] = [];
  for (const row of rows) {
    const day = (date.key ? dayOf(row.values[date.key], date.timestamp, timeZone) : null) ?? "";
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else out.push({ day, rows: [row] });
  }
  return out;
}

/** A stable tone (1–6) for a cover value, so equal values share a colour. */
export function coverTone(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return (hash % 6) + 1;
}

/** A cover value's key for colouring: a reference's id, a choice's key, or the text itself. */
export function coverKey(value: LensValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value.id;
  return String(value);
}
