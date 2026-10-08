import { NextResponse } from "next/server";

/**
 * GET /api/health/version: which commit is this site running?
 *
 * Read by the deploy smoke check and the staging load test, which must
 * measure the commit being certified. Answers the commit the container image
 * was built from (APP_COMMIT, set by the Dockerfile) and nothing else; the
 * repository is public, so the commit is not a secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const commit = process.env.APP_COMMIT?.trim() || "unknown";
  return NextResponse.json({ commit }, { headers: { "cache-control": "no-store" } });
}
