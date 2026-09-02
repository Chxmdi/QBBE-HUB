import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability";

type JobDatabaseClient = Pick<SupabaseClient, "from">;

export interface JobRunInput {
  organizationId: string;
  jobName: string;
  status: "succeeded" | "failed";
  details?: Record<string, boolean | number | string | null>;
  error?: string | null;
  startedAt?: string;
}

/** Prevent provider credentials from entering an admin-visible execution log. */
export function sanitizeJobError(error: string | null | undefined): string | null {
  if (!error) return null;
  return error
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|client_secret)=([^\s&]+)/gi, "$1=[redacted]")
    .slice(0, 1000);
}

/** A failed ledger write must not hide the originating job result. */
export async function recordJobRun(client: JobDatabaseClient, input: JobRunInput) {
  const sanitized = sanitizeJobError(input.error);
  const { error } = await client.from("background_job_run").insert({
    organization_id: input.organizationId,
    job_name: input.jobName,
    status: input.status,
    details: input.details ?? {},
    error: sanitized,
    started_at: input.startedAt ?? new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });
  if (error) console.error("Could not record background job run", { jobName: input.jobName, error: error.message });

  // The ledger row makes an integration failure discoverable; this makes it
  // observable. Without it a sync that breaks at 03:00 waits for somebody to
  // think of opening Admin → Integrations, which is the one thing nobody does
  // when they have no reason to suspect anything is wrong.
  //
  // Reported after the insert so a failing ledger write cannot suppress the
  // alert — those are the runs most worth hearing about.
  if (input.status === "failed") {
    reportError(sanitized ?? `${input.jobName} failed`, {
      source: "integration",
      jobName: input.jobName,
      organizationId: input.organizationId,
      ledgerWritten: !error,
    });
  }
}
