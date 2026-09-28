import { NextResponse } from "next/server";
import { getJobRunnerStatus } from "@/features/jobs/services/runner-status";

/**
 * GET /api/health/jobs: is the job runner wired to this site?
 *
 * Read by the deploy smoke check. Answers one status word and nothing else
 * (no URL, no secret), 200 when ready and 503 otherwise, so a deployment that
 * skipped app.configure_job_runner fails loudly instead of quietly never
 * scanning uploads or sending email.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getJobRunnerStatus();
  return NextResponse.json(
    { jobRunner: status },
    { status: status === "ready" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
