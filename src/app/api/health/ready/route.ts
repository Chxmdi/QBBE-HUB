import { NextResponse } from "next/server";
import { getJobRunnerStatus } from "@/features/jobs/services/runner-status";
import { serverEnvProblems } from "@/lib/env";
import { logEvent } from "@/lib/server-log";

/**
 * GET /api/health/ready: can this server do its work?
 *
 * The container health check (deploy/server/compose.app.yaml) reads this, so a
 * release with missing or wrong settings is reported unhealthy and release.sh
 * puts the previous one back. /api/health/version only proves the process runs.
 *
 * Ready means: the required settings are present and consistent, and one
 * service-role call to the database succeeds (a wrong or missing service key
 * reads "unknown"). Whether jobs are wired to this site is reported by
 * /api/health/jobs instead, because a new environment is configured only
 * after its first release. Further conditions go in CHECKS.
 *
 * Signed-out callers get one word per check and no setting names or values.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = () => Promise<boolean>;

const CHECKS: Record<string, Check> = {
  settings: async () => {
    const problems = serverEnvProblems();
    if (problems.length) logEvent("health.settings_invalid", { problems }, "error");
    return problems.length === 0;
  },
  database: async () => (await getJobRunnerStatus()) !== "unknown",
};

export async function GET() {
  const results = Object.fromEntries(
    await Promise.all(Object.entries(CHECKS).map(async ([name, check]) => [name, await check().catch(() => false)])),
  ) as Record<string, boolean>;
  const ready = Object.values(results).every(Boolean);
  return NextResponse.json(
    { ready, checks: Object.fromEntries(Object.entries(results).map(([k, ok]) => [k, ok ? "ok" : "failed"])) },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
