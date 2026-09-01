import { MissingEnvError } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { nextRun } from "./cron";

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
  const since = new Date(Date.now() - 86_400_000).toISOString();

  const [definitions, runs, queueMetrics] = await Promise.all([
    supabase
      .from("job_definition")
      .select("name, description, schedule, queue, enabled")
      .order("name"),
    supabase
      .from("job_run")
      .select(
        "id, job_name, status, started_at, finished_at, duration_ms, processed_count, failed_count, error, metadata",
      )
      .order("started_at", { ascending: false })
      .limit(300),
    readQueueMetrics(),
  ]);

  const { queueResult, deadLetterResult } = queueMetrics;

  const runRows = (runs.data ?? []) as unknown as RunRow[];
  const now = new Date();

  const latestByJob = new Map<string, RunRow>();
  const failuresByJob = new Map<string, number>();

  // A run that returned normally having dropped part of its batch counts as a
  // failure here. The column answers "did the work happen", and a handler that
  // reports its own per-item failures would otherwise never reach this page.
  const droppedWork = (row: RunRow) => row.status === "failed" || row.failed_count > 0;

  for (const row of runRows) {
    if (!latestByJob.has(row.job_name)) latestByJob.set(row.job_name, row);
    if (droppedWork(row) && row.started_at >= since) {
      failuresByJob.set(row.job_name, (failuresByJob.get(row.job_name) ?? 0) + 1);
    }
  }

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
        lastRun: last ? toSummary(last) : null,
        nextRunAt: next ? next.toISOString() : null,
        failuresLast24h: failuresByJob.get(definition.name) ?? 0,
      };
    },
  );

  const recentFailures = runRows
    .filter(droppedWork)
    .slice(0, 10)
    .map((row) => ({ ...toSummary(row), jobName: row.job_name }));

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
