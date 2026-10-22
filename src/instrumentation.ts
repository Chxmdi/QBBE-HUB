import type { Instrumentation } from "next";

/**
 * Runs once when the server starts, and on every server-side error.
 *
 * register(): on a deployed server (QBBE_ENV set by compose.app.yaml) refuse to
 * start when a required setting is missing or inconsistent, so release.sh sees
 * an unhealthy container and restores the previous release instead of serving
 * traffic with, for example, another project's service key. Local development
 * and CI leave QBBE_ENV unset and are not checked.
 *
 * onRequestError(): every error thrown while rendering a page or running a
 * server action or route handler goes to error monitoring (reportError), not
 * only the few call sites that report explicitly.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { isDeployedEnvironment, serverEnvProblems } = await import("@/lib/env");
  if (!isDeployedEnvironment()) return;
  const problems = serverEnvProblems();
  if (problems.length === 0) return;
  console.error(JSON.stringify({ event: "startup.settings_invalid", environment: process.env.QBBE_ENV, problems }));
  process.exit(1);
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/observability");
  reportError(error, {
    source: "server",
    digest: (error as { digest?: unknown })?.digest,
    method: request.method,
    // The path only: query strings can carry invitation or reset tokens.
    path: request.path.split(/[?#]/)[0],
    routePath: context.routePath,
    routeType: context.routeType,
    requestId: request.headers["x-request-id"],
  });
};
