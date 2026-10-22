import { MissingEnvError } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { nextRun, scheduleIntervalMs } from "./cron";
import { isOverdue } from "./run-health";

/**
 * Everything Admin → Jobs needs.
 *
 * Row data — job definitions and runs — is read as the signed-in administrator,
 * so RLS decides what appears; a non-admin sees nothing.
 *
 * Queue metrics are different. They are operational aggregates with no per-row
 * owner, and exposing a queue-reading function to signed-in users would put a
 * SECURITY DEFINER route on the public API whose safety rests on a check inside
 * the function. Instead they have no PostgREST route at all and are read
 * through the service role, behind the `requireAdmin()` gate on the page.
 */

export interface JobRunSummary {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  processedCount: number;
  failedCount: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface JobHealth {
  name: string;
  description: string;
  schedule: string;
  queue: string | null;
  enabled: boolean;
  lastRun: JobRunSummary | null;
  nextRunAt: string | null;
  failuresLast24h: number;
  /** Enabled, and no start for more than three schedule intervals. */
  overdue: boolean;
}

export interface QueueHealth {
  queueName: string;
  queueLength: number;
  visibleLength: number;
  oldestMessageAgeSeconds: number | null;
  totalMessages: number;
  archivedCount: number;
}

export interface DeadLetter {
  queueName: string;
  msgId: number;
  readCount: number;
  enqueuedAt: string;
  archivedAt: string;
  message: Record<string, unknown>;
}

interface DefinitionRow {
  name: string;
  description: string;
  schedule: string;
  queue: string | null;
  enabled: boolean;
}

interface RunRow {
  id: string;
  job_name: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  processed_count: number;
  failed_count: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

function toSummary(row: RunRow): JobRunSummary {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    processedCount: row.processed_count,
    failedCount: row.failed_count,
    error: row.error,
    metadata: row.metadata ?? {},
  };
}

interface SummaryRow {
  job_name: string;
  last_run_id: string;
  last_status: RunRow["status"];
  last_started_at: string;
  last_finished_at: string | null;
  last_duration_ms: number | null;
  last_processed_count: number;
  last_failed_count: number;
  last_error: string | null;
  last_metadata: Record<string, unknown> | null;
  failures_24h: number;
}

export function summaryToRun(row: SummaryRow): JobRunSummary {
  return {
    id: row.last_run_id,
    status: row.last_status,
    startedAt: row.last_started_at,
    finishedAt: row.last_finished_at,
    durationMs: row.last_duration_ms,
    processedCount: row.last_processed_count,
    failedCount: row.last_failed_count,
    error: row.last_error,
    metadata: row.last_metadata ?? {},
  };
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Queue depth and dead letters, via the service role. A deployment without the
 * service-role key still renders the page — it just says so, rather than
 * failing the whole panel.
 */
async function readQueueMetrics(): Promise<{
  queueResult: RpcResult;
  deadLetterResult: RpcResult;
}> {
  try {
    const service = createSupabaseServiceClient();
    const [queueResult, deadLetterResult] = await Promise.all([
      service.rpc("job_queue_health"),
      service.rpc("job_queue_dead_letters", { p_limit: 20 }),
    ]);
    return { queueResult, deadLetterResult };
  } catch (error) {
    const message =
      error instanceof MissingEnvError
        ? "SUPABASE_SERVICE_ROLE_KEY is not set for this deployment, so queue metrics cannot be read."
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      queueResult: { data: null, error: { message } },
      deadLetterResult: { data: null, error: { message } },
    };
  }
}

export async function getJobHealth(): Promise<{
  jobs: JobHealth[];
  recentFailures: (JobRunSummary & { jobName: string })[];
  queues: QueueHealth[];
  deadLetters: DeadLetter[];
  queueError: string | null;
}> {
  const supabase = await createSupabaseServerClient();

  // The newest run of every job and its real 24-hour failure count, from one
  // call (public.job_health_summary). Reading the newest N runs across all
  // jobs instead covered about half an hour on a normal day, so daily jobs
  // read "Never run" and failures were undercounted.
  const [definitions, summary, failures, queueMetrics] = await Promise.all([
    supabase
      .from("job_definition")
      .select("name, description, schedule, queue, enabled")
      .order("name"),
    supabase.rpc("job_health_summary"),
    // A run that returned normally having dropped part of its batch counts as
    // a failure too: the column answers "did the work happen".
    supabase
      .from("job_run")
      .select(
        "id, job_name, status, started_at, finished_at, duration_ms, processed_count, failed_count, error, metadata",
      )
      .or("status.eq.failed,failed_count.gt.0")
      .order("started_at", { ascending: false })
      .limit(10),
    readQueueMetrics(),
  ]);

  const { queueResult, deadLetterResult } = queueMetrics;
  // Failing loudly beats every job reading "Never run" (for example when the
  // app is deployed before the migration that adds job_health_summary).
  const readError = definitions.error ?? summary.error ?? failures.error;
  if (readError) throw new Error(`Could not read job health: ${readError.message}`);
  const now = new Date();

  const latestByJob = new Map<string, SummaryRow>();
  for (const row of (summary.data ?? []) as SummaryRow[]) latestByJob.set(row.job_name, row);

  const jobs: JobHealth[] = ((definitions.data ?? []) as DefinitionRow[]).map(
    (definition) => {
      const last = latestByJob.get(definition.name);
      const next = definition.enabled ? nextRun(definition.schedule, now) : null;
      return {
        name: definition.name,
        description: definition.description,
        schedule: definition.schedule,
        queue: definition.queue,
        enabled: definition.enabled,
        lastRun: last ? summaryToRun(last) : null,
        nextRunAt: next ? next.toISOString() : null,
        failuresLast24h: last?.failures_24h ?? 0,
        overdue: isOverdue(definition.enabled, last?.last_started_at, scheduleIntervalMs(definition.schedule, now), now),
      };
    },
  );

  const recentFailures = ((failures.data ?? []) as unknown as RunRow[]).map((row) => ({
    ...toSummary(row),
    jobName: row.job_name,
  }));

  const queues: QueueHealth[] = (
    (queueResult.data ?? []) as {
      queue_name: string;
      queue_length: number;
      visible_length: number;
      oldest_message_age_seconds: number | null;
      total_messages: number;
      archived_count: number;
    }[]
  ).map((row) => ({
    queueName: row.queue_name,
    queueLength: row.queue_length,
    visibleLength: row.visible_length,
    oldestMessageAgeSeconds: row.oldest_message_age_seconds,
    totalMessages: row.total_messages,
    archivedCount: row.archived_count,
  }));

  const deadLetters: DeadLetter[] = (
    (deadLetterResult.data ?? []) as {
      queue_name: string;
      msg_id: number;
      read_ct: number;
      enqueued_at: string;
      archived_at: string;
      message: Record<string, unknown>;
    }[]
  ).map((row) => ({
    queueName: row.queue_name,
    msgId: row.msg_id,
    readCount: row.read_ct,
    enqueuedAt: row.enqueued_at,
    archivedAt: row.archived_at,
    message: row.message ?? {},
  }));

  return {
    jobs,
    recentFailures,
    queues,
    deadLetters,
    // Surfaced rather than swallowed: an admin needs to know the difference
    // between "no queued work" and "could not read the queues".
    queueError: queueResult.error?.message ?? deadLetterResult.error?.message ?? null,
  };
}
