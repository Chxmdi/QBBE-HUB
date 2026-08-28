import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  metricProgress,
  summarizeDelivery,
  type DeliverySummary,
  type MetricDirection,
  type MetricProgress,
  type OperationStatus,
} from "@/features/outcomes/schemas";

/**
 * Reading a program's delivery and its outcomes.
 *
 * Runs as the signed-in person. Everyone in the organization can read both —
 * volunteers deliver these sessions, and a record they cannot see is one they
 * cannot correct — while only staff can write, which the policies decide.
 */

export interface OperationRow {
  id: string;
  title: string;
  occurred_on: string;
  location: string | null;
  status: OperationStatus;
  attendee_count: number | null;
  volunteer_count: number | null;
  duration_hours: string | null;
  staff_hours: string | null;
  contact_hours: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  leader: { id: string; full_name: string } | null;
  project: { id: string; name: string } | null;
}

export interface MeasurementRow {
  id: string;
  measured_on: string;
  value: string;
  source: string | null;
  sample_size: number | null;
  note: string | null;
}

export interface MetricRow {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  direction: MetricDirection;
  baseline: string | null;
  baseline_on: string | null;
  target: string | null;
  target_on: string | null;
  retired_at: string | null;
  owner: { id: string; full_name: string } | null;
  measurements: MeasurementRow[];
}

export interface MetricWithProgress extends MetricRow {
  latest: MeasurementRow | null;
  progress: MetricProgress;
}

export interface ProgramOutcomes {
  operations: OperationRow[];
  summary: DeliverySummary;
  metrics: MetricWithProgress[];
  retiredMetrics: MetricWithProgress[];
}

const OPERATION_SELECT =
  "id, title, occurred_on, location, status, attendee_count, volunteer_count, " +
  "duration_hours, staff_hours, contact_hours, notes, cancellation_reason, " +
  "leader:led_by(id, full_name), project:project_id(id, name)";

const METRIC_SELECT =
  "id, name, description, unit, direction, baseline, baseline_on, target, " +
  "target_on, retired_at, owner:owner_id(id, full_name), " +
  "measurements:outcome_measurement(id, measured_on, value, source, sample_size, note)";

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Attaches the latest reading and the progress it implies. */
export function withProgress(metric: MetricRow): MetricWithProgress {
  // Newest first, so "latest" is the first element whatever order the join
  // returned rows in — an embedded select carries no ordering guarantee.
  const measurements = [...(metric.measurements ?? [])].sort((a, b) =>
    b.measured_on.localeCompare(a.measured_on),
  );
  const latest = measurements[0] ?? null;

  return {
    ...metric,
    measurements,
    latest,
    progress: metricProgress({
      direction: metric.direction,
      baseline: toNumber(metric.baseline),
      target: toNumber(metric.target),
      latest: latest ? toNumber(latest.value) : null,
    }),
  };
}

export async function getProgramOutcomes(
  programId: string,
): Promise<ProgramOutcomes> {
  const supabase = await createSupabaseServerClient();

  const [{ data: operations }, { data: metrics }] = await Promise.all([
    supabase
      .from("program_operation")
      .select(OPERATION_SELECT)
      .eq("program_id", programId)
      .order("occurred_on", { ascending: false })
      .limit(200),
    supabase
      .from("outcome_metric")
      .select(METRIC_SELECT)
      .eq("program_id", programId)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  const operationRows = (operations ?? []) as unknown as OperationRow[];
  const metricRows = ((metrics ?? []) as unknown as MetricRow[]).map(withProgress);

  return {
    operations: operationRows,
    summary: summarizeDelivery(operationRows),
    metrics: metricRows.filter((m) => !m.retired_at),
    retiredMetrics: metricRows.filter((m) => m.retired_at),
  };
}
