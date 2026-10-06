/**
 * The timeline lens (V1-2) as pure functions: where bars go, which tasks
 * depend on which, and what a move does to the tasks after it.
 *
 * Dependencies are finish-to-start: a blocked task should start after every
 * task blocking it is due. Moving a task later pushes a dependent only when
 * the dependent would otherwise start too early, and by just enough; moving a
 * task earlier never pulls anything.
 */

export const DAY_WIDTH = 28;
export const ROW_HEIGHT = 40;

export interface TimelineBar {
  id: string;
  title: string;
  start: string;
  end: string;
  /** False for a task with only one date: drawn as a one-day bar. */
  hasRange: boolean;
  editable: boolean;
  done: boolean;
}

export interface Edge {
  blocking: string;
  blocked: string;
}

export interface Move {
  id: string;
  start: string;
  due: string;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** A task's bar from its start and due dates; null when it has neither. */
export function barFor(
  row: { id: string; title: string; start: string | null; due: string | null; done?: boolean },
  editable: boolean,
): TimelineBar | null {
  const start = row.start ?? row.due;
  const end = row.due ?? row.start;
  if (!start || !end) return null;
  return {
    id: row.id,
    title: row.title,
    start: start <= end ? start : end,
    end: start <= end ? end : start,
    hasRange: Boolean(row.start && row.due && row.start !== row.due),
    editable,
    done: row.done ?? false,
  };
}

/** The days the timeline shows: a little before the first bar to a week after the last. */
export function timelineRange(bars: TimelineBar[], today: string): { from: string; to: string; days: number } {
  const starts = bars.map((b) => b.start).concat(today);
  const ends = bars.map((b) => b.end).concat(today);
  let from = addDays(starts.reduce((a, b) => (a < b ? a : b)), -3);
  let to = addDays(ends.reduce((a, b) => (a > b ? a : b)), 7);
  if (daysBetween(from, to) < 41) to = addDays(from, 41);
  if (daysBetween(from, to) > 400) {
    from = addDays(today, -60);
    to = addDays(today, 340);
  }
  return { from, to, days: daysBetween(from, to) + 1 };
}

/** Every task that depends on `id`, directly or through others, nearest first. */
export function dependentsOf(id: string, edges: Edge[]): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const e of edges) {
      if (e.blocking === current && !seen.has(e.blocked)) {
        seen.add(e.blocked);
        out.push(e.blocked);
        queue.push(e.blocked);
      }
    }
  }
  return out;
}

/**
 * The moves for shifting one bar (by whole days, start and end separately,
 * so the same function handles moving and resizing) and the dependents it
 * pushes. Dependents keep their length; ones the viewer cannot edit are
 * reported so the person can decide knowing they will not move.
 */
export function planShift(
  bars: TimelineBar[],
  edges: Edge[],
  id: string,
  deltaStart: number,
  deltaEnd: number,
): { primary: Move | null; dependents: Move[]; blockedBy: string[] } {
  const byId = new Map(bars.map((b) => [b.id, b]));
  const bar = byId.get(id);
  if (!bar) return { primary: null, dependents: [], blockedBy: [] };
  let start = addDays(bar.start, deltaStart);
  const end = addDays(bar.end, deltaEnd);
  if (start > end) start = end;
  const primary = { id, start, due: end };

  const ends = new Map(bars.map((b) => [b.id, b.end]));
  ends.set(id, end);
  const dependents: Move[] = [];
  const blockedBy: string[] = [];
  for (const depId of dependentsOf(id, edges)) {
    const dep = byId.get(depId);
    if (!dep) continue;
    const blockers = edges.filter((e) => e.blocked === depId).map((e) => ends.get(e.blocking)).filter((d): d is string => Boolean(d));
    if (!blockers.length) continue;
    const latest = blockers.reduce((a, b) => (a > b ? a : b));
    const earliestStart = addDays(latest, 1);
    if (dep.start >= earliestStart) continue;
    const shift = daysBetween(dep.start, earliestStart);
    if (!dep.editable) {
      blockedBy.push(depId);
      continue;
    }
    const move = { id: depId, start: addDays(dep.start, shift), due: addDays(dep.end, shift) };
    ends.set(depId, move.due);
    dependents.push(move);
  }
  return { primary, dependents, blockedBy };
}

/** x of a day's left edge. */
export function dayX(from: string, day: string): number {
  return daysBetween(from, day) * DAY_WIDTH;
}

/** An SVG path from the end of one bar to the start of another, with a small elbow. */
export function arrowPath(from: string, fromBar: TimelineBar, fromRow: number, toBar: TimelineBar, toRow: number): string {
  const x1 = dayX(from, fromBar.end) + DAY_WIDTH;
  const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const x2 = dayX(from, toBar.start);
  const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const elbow = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 16));
  return `M ${x1} ${y1} H ${elbow} V ${y2} H ${x2}`;
}
