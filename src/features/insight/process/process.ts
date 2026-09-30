/**
 * Process analytics (V3-3): how work flows. Time in each status and where it
 * piles up, turnaround per type, and approval wait times, all from events.
 *
 * Pure: the page reads task status changes (activity_event today, object_event
 * once M9a lands), approval_event and the records themselves under the
 * viewer's RLS (./process.source.ts), and these functions do the arithmetic.
 */

const HOUR = 3_600_000;

/** Statuses a task leaves only by being reopened: time in them is not waiting. */
export const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);

export interface StatusChange {
  at: string;
  from: string | null;
  to: string;
}

export interface TaskHistory {
  id: string;
  createdAt: string;
  currentStatus: string;
  /** Status changes, in any order. */
  changes: StatusChange[];
}

export interface StatusInterval {
  status: string;
  start: number;
  end: number;
  /** Still in this status now. */
  open: boolean;
}

/**
 * A task's time in each status. The first status is the one the first change
 * moved away from (or the current one if it never moved). Time is counted
 * from `since` at the earliest, because changes before the window were not
 * read, and never in a terminal status.
 */
export function statusIntervals(history: TaskHistory, now: Date, since?: Date): StatusInterval[] {
  const changes = [...history.changes].sort((a, b) => a.at.localeCompare(b.at));
  const floor = since ? since.getTime() : -Infinity;
  const intervals: StatusInterval[] = [];
  let status = changes[0]?.from ?? (changes.length ? changes[0].to : history.currentStatus);
  let start = Math.max(new Date(history.createdAt).getTime(), floor);
  const push = (end: number, open: boolean) => {
    if (!TERMINAL_STATUSES.has(status) && end > start) intervals.push({ status, start, end, open });
  };
  for (const change of changes) {
    const at = new Date(change.at).getTime();
    if (Number.isNaN(at)) continue;
    push(Math.max(at, start), false);
    status = change.to;
    start = Math.max(at, start);
  }
  push(now.getTime(), true);
  return intervals;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const average = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);

export interface StatusStat {
  status: string;
  /** Times a task spent a stretch in this status. */
  visits: number;
  averageHours: number;
  medianHours: number;
  /** Tasks in this status right now, and the longest of their current stretches. */
  current: number;
  longestCurrentHours: number;
}

export function timeInStatus(histories: TaskHistory[], now: Date, since?: Date): StatusStat[] {
  const byStatus = new Map<string, { durations: number[]; current: number[] }>();
  for (const history of histories) {
    for (const interval of statusIntervals(history, now, since)) {
      const entry = byStatus.get(interval.status) ?? { durations: [], current: [] };
      const hours = (interval.end - interval.start) / HOUR;
      entry.durations.push(hours);
      if (interval.open) entry.current.push(hours);
      byStatus.set(interval.status, entry);
    }
  }
  return [...byStatus.entries()]
    .map(([status, entry]) => ({
      status,
      visits: entry.durations.length,
      averageHours: average(entry.durations)!,
      medianHours: median(entry.durations)!,
      current: entry.current.length,
      longestCurrentHours: entry.current.length ? Math.max(...entry.current) : 0,
    }))
    .sort((a, b) => b.averageHours - a.averageHours || a.status.localeCompare(b.status));
}

/**
 * The status work waits in longest on average, among those with enough
 * visits to mean something; null when nothing qualifies.
 */
export function bottleneck(stats: StatusStat[], minimumVisits = 2): StatusStat | null {
  return stats.find((stat) => stat.visits >= minimumVisits) ?? null;
}

export interface TurnaroundInput {
  type: string;
  start: string;
  end: string | null;
}

export interface Turnaround {
  type: string;
  finished: number;
  averageHours: number | null;
  medianHours: number | null;
  open: number;
}

/** Start to finish per type, over what finished; the unfinished are counted. */
export function turnaround(items: TurnaroundInput[], types: readonly string[]): Turnaround[] {
  return types.map((type) => {
    const mine = items.filter((item) => item.type === type);
    const durations = mine
      .filter((item) => item.end)
      .map((item) => (new Date(item.end!).getTime() - new Date(item.start).getTime()) / HOUR)
      .filter((hours) => Number.isFinite(hours) && hours >= 0);
    return {
      type,
      finished: durations.length,
      averageHours: average(durations),
      medianHours: median(durations),
      open: mine.filter((item) => !item.end).length,
    };
  });
}

export interface ApprovalEventRow {
  itemId: string;
  kind: string;
  step: number | null;
  at: string;
}

export interface ApprovalItemRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface ApprovalWaits {
  decisions: number;
  averageHours: number | null;
  medianHours: number | null;
  byStep: { step: number; decisions: number; averageHours: number }[];
  /** Pending items, longest waiting first. */
  waiting: { id: string; title: string; hours: number }[];
}

const DECISIONS = new Set(["approved", "rejected"]);

/**
 * How long each decision took: from the submission or the previous step's
 * decision to this one. Pending items wait from their last decision (or
 * submission) until now.
 */
export function approvalWaits(items: ApprovalItemRow[], events: ApprovalEventRow[], now: Date): ApprovalWaits {
  const eventsByItem = new Map<string, ApprovalEventRow[]>();
  for (const event of events) eventsByItem.set(event.itemId, [...(eventsByItem.get(event.itemId) ?? []), event]);
  const waits: { step: number; hours: number }[] = [];
  const waiting: ApprovalWaits["waiting"] = [];
  for (const item of items) {
    const trail = (eventsByItem.get(item.id) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    const submitted = trail.find((event) => event.kind === "submitted");
    let clock = new Date(submitted?.at ?? item.createdAt).getTime();
    for (const event of trail) {
      if (event.kind === "submitted") {
        // A resubmission restarts the clock.
        clock = new Date(event.at).getTime();
      } else if (DECISIONS.has(event.kind)) {
        const at = new Date(event.at).getTime();
        waits.push({ step: event.step ?? 1, hours: Math.max(at - clock, 0) / HOUR });
        clock = at;
      }
    }
    if (item.status === "pending") {
      waiting.push({ id: item.id, title: item.title, hours: Math.max(now.getTime() - clock, 0) / HOUR });
    }
  }
  const steps = [...new Set(waits.map((wait) => wait.step))].sort((a, b) => a - b);
  return {
    decisions: waits.length,
    averageHours: average(waits.map((wait) => wait.hours)),
    medianHours: median(waits.map((wait) => wait.hours)),
    byStep: steps.map((step) => {
      const mine = waits.filter((wait) => wait.step === step).map((wait) => wait.hours);
      return { step, decisions: mine.length, averageHours: average(mine)! };
    }),
    waiting: waiting.sort((a, b) => b.hours - a.hours),
  };
}

/** Status changes out of an activity_event's metadata (P0-TSK-05 shape). */
export function statusChangesFromMetadata(metadata: unknown, at: string): StatusChange[] {
  const changes = (metadata as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    const { field, from, to } = (change ?? {}) as { field?: unknown; from?: unknown; to?: unknown };
    if (field !== "status" || typeof to !== "string") return [];
    return [{ at, from: typeof from === "string" ? from : null, to }];
  });
}
