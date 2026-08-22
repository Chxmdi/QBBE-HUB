import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MissingEnvError, jobSecret } from "@/lib/env";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  DisabledJobError,
  UnknownJobError,
  runJob,
} from "@/features/jobs/services/runner";

/**
 * The scheduler's entry point.
 *
 * pg_cron calls POST /api/jobs/<name> with the shared secret in `x-job-secret`
 * (see `app.dispatch_job` in migration 0008). Nothing else may reach it:
 *
 *   - POST only, so a crawler or a prefetch cannot start work;
 *   - constant-time secret comparison, so the header cannot be discovered by
 *     timing the endpoint;
 *   - an unknown or disabled job name is refused before any work begins;
 *   - a rate limit per job name, so a leaked secret cannot be used to hammer
 *     the runtime faster than the scheduler ever would;
 *   - the response never echoes the secret or an internal stack.
 *
 * The route runs on the Node runtime because it uses the service-role key and
 * node:crypto, and it is force-dynamic because there is nothing to cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(presented: string | null): boolean {
  if (!presented) return false;
  let expected: string;
  try {
    expected = jobSecret();
  } catch (error) {
    if (error instanceof MissingEnvError) return false;
    throw error;
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths, so the length check comes first.
  // It leaks only the secret's length, which is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ job: string }> },
) {
  if (!secretMatches(request.headers.get("x-job-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { job } = await params;

  // Well above any real schedule (the busiest job runs once a minute), so this
  // only ever catches a loop or an abused secret.
  const limited = await enforceRateLimit("job:run", job);
  if (limited) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  try {
    const outcome = await runJob(job);
    const body = {
      job: outcome.jobName,
      status: outcome.status,
      processed: outcome.processed,
      failed: outcome.failed,
      durationMs: outcome.durationMs,
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    // A failed run is a recorded outcome, not a broken request: 200 with a
    // failed status keeps pg_net's log clean while Admin → Jobs shows the truth.
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (error instanceof UnknownJobError) {
      return NextResponse.json({ error: "unknown job" }, { status: 404 });
    }
    if (error instanceof DisabledJobError) {
      return NextResponse.json({ error: "job disabled" }, { status: 409 });
    }
    if (error instanceof MissingEnvError) {
      console.error(JSON.stringify({ event: "job.misconfigured", job, error: error.message }));
      return NextResponse.json({ error: "job runner is not configured" }, { status: 503 });
    }
    console.error(
      JSON.stringify({
        event: "job.route_failed",
        job,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return NextResponse.json({ error: "job could not start" }, { status: 500 });
  }
}
