/**
 * Goal progress (Workspace OS V1-11), worked out from the linked records on
 * every read, so it moves by itself as tasks are finished and measurements
 * are recorded. Each linked project and each measured metric weighs the same.
 */
export interface ProgressInput {
  kind: "project" | "metric";
  ref_id: string;
  label: string | null;
  project_completed: boolean | null;
  tasks_done: number | null;
  tasks_total: number | null;
  metric_direction: string | null;
  metric_baseline: number | string | null;
  metric_target: number | string | null;
  metric_latest: number | string | null;
  metric_latest_on: string | null;
}

export interface ProgressPart {
  kind: "project" | "metric";
  id: string;
  label: string | null;
  /** 0 to 1, or null when it cannot be measured yet (a metric with no baseline, target or measurement). */
  progress: number | null;
  detail: { done?: number; total?: number; completed?: boolean; latest?: number; target?: number; latestOn?: string | null };
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const num = (value: number | string | null): number | null =>
  value === null || value === undefined || value === "" ? null : Number(value);

export function progressPart(input: ProgressInput): ProgressPart {
  if (input.kind === "project") {
    const done = input.tasks_done ?? 0;
    const total = input.tasks_total ?? 0;
    const progress = input.project_completed ? 1 : total > 0 ? done / total : 0;
    return {
      kind: "project",
      id: input.ref_id,
      label: input.label,
      progress,
      detail: { done, total, completed: input.project_completed === true },
    };
  }
  const baseline = num(input.metric_baseline);
  const target = num(input.metric_target);
  const latest = num(input.metric_latest);
  // The distance from baseline to target, whichever way it runs: a
  // "decrease" metric has target < baseline and the same formula holds.
  const progress =
    baseline === null || target === null || latest === null || target === baseline
      ? null
      : clamp((latest - baseline) / (target - baseline));
  return {
    kind: "metric",
    id: input.ref_id,
    label: input.label,
    progress,
    detail: { latest: latest ?? undefined, target: target ?? undefined, latestOn: input.metric_latest_on },
  };
}

/** The goal's progress: the mean of every measurable part, or null when none is. */
export function goalProgress(parts: ProgressPart[]): number | null {
  const measured = parts.map((p) => p.progress).filter((p): p is number => p !== null);
  if (measured.length === 0) return null;
  return measured.reduce((sum, p) => sum + p, 0) / measured.length;
}

export function percent(progress: number | null): number | null {
  return progress === null ? null : Math.round(progress * 100);
}
