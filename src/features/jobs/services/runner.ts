import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { JOB_HANDLERS } from "./handlers";

/**
 * Executes one scheduled job and records what happened.
 *
 * Three invariants hold here so that Admin → Jobs can be trusted:
 *   - every execution writes exactly one `job_run` row, whatever the outcome;
 *   - a job name absent from `job_definition`, or disabled there, does not run,
 *     so an old cron entry or a stray HTTP call cannot execute code the
 *     organization has switched off;
 *   - the counts on that row describe the work, not the process: a handler
 *     that fails half-way records what it finished (`PartialJobFailure`), and
 *     a handler that returns with `failed > 0` is not shown as a clean run.
 *
 * Concurrency is safe without a lock. Queue-backed jobs are protected by the
 * pgmq visibility timeout, and sweep jobs write only deduplicated rows, so two
 * overlapping runs converge on the same result.
 */

export interface JobDefinition {
  name: string;
  description: string;
  schedule: string;
  queue: string | null;
  enabled: boolean;
  batch_size: number;
  max_attempts: number;
}

export interface JobContext {
  db: SupabaseClient;
  definition: JobDefinition;
  now: Date;
}

export interface JobResult {
  processed: number;
  failed: number;
  metadata?: Record<string, unknown>;
}

export type JobHandler = (context: JobContext) => Promise<JobResult>;

export class UnknownJobError extends Error {
  constructor(name: string) {
    super(`No job named "${name}" is registered.`);
    this.name = "UnknownJobError";
  }
}

export class DisabledJobError extends Error {
  constructor(name: string) {
    super(`The job "${name}" is disabled.`);
    this.name = "DisabledJobError";
  }
}

/**
 * Thrown by a handler that got part-way through a batch and cannot continue.
 *
 * A plain throw tells the runner nothing but "it broke", so a run that
 * delivered twenty messages and then lost the queue would be recorded as
 * `0 processed` — which in Admin → Jobs reads as an empty tick rather than as
 * most of a batch having landed. Carrying the counts keeps the ledger honest
 * about what actually happened before the failure.
 */
export class PartialJobFailure extends Error {
  readonly result: JobResult;

  constructor(message: string, result: JobResult) {
    super(message);
    this.name = "PartialJobFailure";
    this.result = result;
  }
}

/** Runs longer than this are treated as abandoned by a killed process. */
const STALE_RUN_MINUTES = 15;

async function closeAbandonedRuns(db: SupabaseClient, jobName: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  await db
    .from("job_run")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: `Run did not report a result within ${STALE_RUN_MINUTES} minutes; the process was likely terminated.`,
    })
    .eq("job_name", jobName)
    .eq("status", "running")
    .lt("started_at", cutoff);
}

export interface RunOutcome extends JobResult {
  jobName: string;
  runId: string;
  status: "succeeded" | "failed";
  durationMs: number;
  error?: string;
}

export async function runJob(jobName: string): Promise<RunOutcome> {
  const db = createSupabaseServiceClient();

  const handler = JOB_HANDLERS[jobName];
  if (!handler) throw new UnknownJobError(jobName);

  const { data: definitionRow, error: definitionError } = await db
    .from("job_definition")
    .select("name, description, schedule, queue, enabled, batch_size, max_attempts")
    .eq("name", jobName)
    .maybeSingle();

  if (definitionError) {
    throw new Error(`could not load job definition: ${definitionError.message}`);
  }
  if (!definitionRow) throw new UnknownJobError(jobName);

  const definition = definitionRow as unknown as JobDefinition;
  if (!definition.enabled) throw new DisabledJobError(jobName);

  await closeAbandonedRuns(db, jobName);

  const startedAt = Date.now();
  const { data: runRow, error: runError } = await db
    .from("job_run")
    .insert({ job_name: jobName, status: "running" })
    .select("id")
    .single();

  if (runError || !runRow) {
    throw new Error(`could not open a job run: ${runError?.message ?? "no row"}`);
  }
  const runId = runRow.id as string;

  try {
    const result = await handler({ db, definition, now: new Date() });
    const durationMs = Date.now() - startedAt;

    await db
      .from("job_run")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: result.processed,
        failed_count: result.failed,
        metadata: result.metadata ?? {},
      })
      .eq("id", runId);

    return {
      jobName,
      runId,
      status: "succeeded",
      durationMs,
      processed: result.processed,
      failed: result.failed,
      metadata: result.metadata,
    };
  } catch (cause) {
    const durationMs = Date.now() - startedAt;
    const message = cause instanceof Error ? cause.message : String(cause);

    // A handler that died still did whatever it had already done. When it can
    // say how much, record that; when it cannot, the run counts as one failure
    // rather than as a row of zeros that reads like a quiet, healthy tick.
    const partial = cause instanceof PartialJobFailure ? cause.result : null;
    const processed = partial?.processed ?? 0;
    const failed = Math.max(partial?.failed ?? 0, 1);

    await db
      .from("job_run")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: processed,
        failed_count: failed,
        metadata: partial?.metadata ?? {},
        error: message.slice(0, 2000),
      })
      .eq("id", runId);

    return {
      jobName,
      runId,
      status: "failed",
      durationMs,
      processed,
      failed,
      metadata: partial?.metadata,
      error: message,
    };
  }
}
