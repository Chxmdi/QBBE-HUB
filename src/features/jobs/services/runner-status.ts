import { MissingEnvError, appUrl, jobSecret } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Whether pg_cron can reach this deployment's job route. One word, never the
 * stored URL or secret: see app.job_runner_status.
 */
export type JobRunnerStatus =
  | "ready"
  | "not_configured"
  | "other_site"
  | "secret_mismatch"
  | "app_secret_missing"
  | "unknown";

export async function getJobRunnerStatus(): Promise<JobRunnerStatus> {
  let secret: string | null = null;
  try {
    secret = jobSecret();
  } catch (error) {
    if (!(error instanceof MissingEnvError)) throw error;
  }
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("job_runner_status", {
      p_site_origin: appUrl(),
      p_app_secret: secret,
    });
    if (error || typeof data !== "string") return "unknown";
    return data as JobRunnerStatus;
  } catch {
    return "unknown";
  }
}

/** What an administrator should do about each status, in plain words. */
export const JOB_RUNNER_FIX: Record<Exclude<JobRunnerStatus, "ready">, string> = {
  not_configured:
    "Background jobs are not connected to this site, so uploads never pass their security check and no notification email is sent. In the Supabase SQL editor run: select app.configure_job_runner('<this site's address>', '<CRON_JOB_SECRET>');",
  other_site:
    "Background jobs are connected to a different site address than this one. Run app.configure_job_runner again with this site's address.",
  secret_mismatch:
    "The job secret stored in the database does not match this site's CRON_JOB_SECRET, so every job call is refused. Run app.configure_job_runner again with the site's current secret.",
  app_secret_missing:
    "This site has no CRON_JOB_SECRET set, so it refuses every job call. Add it in the hosting settings (at least 32 characters) and redeploy.",
  unknown: "The job runner's status could not be read. Check that SUPABASE_SERVICE_ROLE_KEY is set for this site.",
};
