/**
 * The one-line account of a run the debugger leads with (V1-12):
 * "Run #1642: ✓ Trigger ✓ Fetch ✕ Send (reason)".
 *
 * Every attempt is a step record; the summary keeps the last record per step
 * visit, so a retried step shows once, with how it finally went.
 */

export interface SummaryStep {
  position: number;
  step_id: string;
  step_kind: string;
  status: string;
  error: string | null;
  attempt: number;
}

export interface SummaryItem {
  stepId: string;
  kind: string;
  status: string;
  symbol: "✓" | "✕" | "…" | "–";
  reason: string | null;
  attempts: number;
}

const SYMBOL: Record<string, SummaryItem["symbol"]> = {
  succeeded: "✓",
  failed: "✕",
  waiting: "…",
  running: "…",
  skipped: "–",
};

/** The error's short code ("forbidden", "loop_limit") and its sentence. */
export function splitReason(error: string | null): { code: string | null; text: string | null } {
  if (!error) return { code: null, text: null };
  const match = error.match(/^([a-z_]+):\s*(.*)$/s);
  return match ? { code: match[1], text: match[2] || null } : { code: null, text: error };
}

export function summarizeRun(steps: SummaryStep[]): SummaryItem[] {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const items: SummaryItem[] = [];
  for (const step of ordered) {
    const previous = items.at(-1);
    // A retry, or a pause completed on resume, is the same visit to the step.
    const sameVisit = previous && previous.stepId === step.step_id &&
      (step.attempt > 1 || previous.status === "waiting");
    const item: SummaryItem = {
      stepId: step.step_id,
      kind: step.step_kind,
      status: step.status,
      symbol: SYMBOL[step.status] ?? "–",
      reason: step.error,
      attempts: sameVisit ? Math.max(previous!.attempts, step.attempt) : step.attempt,
    };
    if (sameVisit) items[items.length - 1] = item;
    else items.push(item);
  }
  return items;
}

/** "✓ trigger ✓ fetch ✕ send (forbidden: …)" for a heading or a screen reader. */
export function summaryLine(items: SummaryItem[], label: (item: SummaryItem) => string): string {
  return items
    .map((item) => `${item.symbol} ${label(item)}${item.status === "failed" && item.reason ? ` (${item.reason})` : ""}`)
    .join(" ");
}

/** Milliseconds between two timestamps, or null. */
export function durationMs(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** A run can be retried from a step once it has stopped moving. */
export function canRetry(outcome: string): boolean {
  return outcome === "failed" || outcome === "stopped" || outcome === "succeeded" || outcome === "skipped";
}
