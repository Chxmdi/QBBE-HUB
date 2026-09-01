/**
 * How a job run should read on the operator's page.
 *
 * `job_run.status` answers "did the process exit cleanly", which is not the
 * question Admin → Jobs is opened to answer. A queue-backed handler counts its
 * per-message failures in `failed_count` and then returns normally, so a run
 * that dropped three of twenty-five messages is stored as `succeeded`. Showing
 * that as green is the one thing this panel must not do, so a run with
 * failures against its name is classified apart from a clean one.
 *
 * The distinction lives here rather than in the component so it can be tested
 * without rendering, and rather than in `jobs.queries` so a test need not pull
 * in a server-only Supabase client to check it.
 */

export interface RunOutcomeInput {
  status: "running" | "succeeded" | "failed";
  processedCount: number;
  failedCount: number;
}

export type RunOutcome = "never" | "running" | "succeeded" | "partial" | "failed";

export function runOutcome(run: RunOutcomeInput | null): RunOutcome {
  if (!run) return "never";
  if (run.status === "running") return "running";
  if (run.status === "failed") return "failed";
  return run.failedCount > 0 ? "partial" : "succeeded";
}

export function runTone(
  outcome: RunOutcome,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (outcome) {
    case "succeeded":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "running":
      return "info";
    case "never":
      return "neutral";
  }
}

export function runLabel(outcome: RunOutcome, run: RunOutcomeInput | null): string {
  switch (outcome) {
    case "never":
      return "Never run";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "partial":
      // The number is the point: "partial" alone leaves the operator guessing
      // whether one message or the whole batch went missing.
      return `${run?.failedCount ?? 0} failed`;
  }
}
