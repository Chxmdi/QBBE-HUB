import type { JobContext, JobResult } from "../runner";

/**
 * Retention for the runtime's own bookkeeping.
 *
 * Job telemetry and delivery ledgers grow forever if nothing trims them, and
 * both are operational records rather than organizational ones — a delivery
 * from eighteen months ago answers no question anybody asks. Failed runs and
 * failed deliveries are kept longer than successful ones, because those are
 * the rows an investigation needs.
 *
 * Size matters here, not just tidiness (OPS-001). The runner writes one
 * `job_run` row per execution, about 12,700 a day, and the production database
 * is on Supabase's Free plan, which turns read-only at 500 MB. Keeping
 * successes for 30 days held about 91 MB of them. So successful runs now go
 * after 7 days, and successful runs that did nothing at all (most per-minute
 * ticks) after one day. The latest run of every job is always kept, whatever
 * its age, so Admin → Jobs can still show when a weekly or idle job last ran.
 *
 * `background_job_run`, the per-organization ledger the integration jobs
 * write, had no retention at all; it follows the same pattern.
 *
 * pg_cron's own run log (`cron.job_run_details`) is not reachable through the
 * Data API; the `purge-cron-history` cron entry trims it inside the database
 * (migration 20261119010000).
 *
 * Dead-lettered queue messages are deliberately left alone: an administrator
 * should decide what happens to mail that never went out.
 *
 * Rate-limit counters are different again — they are worthless the moment their
 * window closes, so anything older than a day goes.
 */

const SUCCESS_RETENTION_DAYS = 7;
const IDLE_SUCCESS_RETENTION_DAYS = 1;
const FAILURE_RETENTION_DAYS = 180;
const DELIVERY_RETENTION_DAYS = 180;
const LEDGER_SUCCESS_RETENTION_DAYS = 30;
const LEDGER_FAILURE_RETENTION_DAYS = 180;

type Db = JobContext["db"];

/**
 * The newest run of every registered job. Those rows are never purged: the
 * panel and overdue detection read "last run" from them.
 */
async function latestRunIds(db: Db): Promise<string[]> {
  const { data: definitions, error } = await db.from("job_definition").select("name");
  if (error) throw new Error(`could not load job definitions: ${error.message}`);

  const ids: string[] = [];
  for (const { name } of (definitions ?? []) as { name: string }[]) {
    const { data, error: latestError } = await db
      .from("job_run")
      .select("id")
      .eq("job_name", name)
      .order("started_at", { ascending: false })
      .limit(1);
    if (latestError) {
      throw new Error(`could not find the latest run of ${name}: ${latestError.message}`);
    }
    for (const row of (data ?? []) as { id: string }[]) ids.push(row.id);
  }
  return ids;
}

export async function purgeJobHistory({ db, now }: JobContext): Promise<JobResult> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const keep = await latestRunIds(db);
  // PostgREST's `not.in` list; uuids need no quoting.
  const keepList = `(${keep.join(",")})`;
  // Counted rather than returned: the first run after a retention change
  // removes hundreds of thousands of rows, and their ids are of no use.
  const runsToPurge = () => {
    const query = db.from("job_run").delete({ count: "exact" });
    return keep.length > 0 ? query.not("id", "in", keepList) : query;
  };

  const { count: purgedRuns, error: runError } = await runsToPurge()
    .eq("status", "succeeded")
    .lt("started_at", daysAgo(SUCCESS_RETENTION_DAYS));

  if (runError) throw new Error(`could not purge job runs: ${runError.message}`);

  // A tick that found nothing to do and dropped nothing tells nobody anything
  // after a day; the panel's 24-hour view is all it was ever for.
  const { count: purgedIdle, error: idleError } = await runsToPurge()
    .eq("status", "succeeded")
    .eq("processed_count", 0)
    .eq("failed_count", 0)
    .lt("started_at", daysAgo(IDLE_SUCCESS_RETENTION_DAYS));

  if (idleError) throw new Error(`could not purge idle runs: ${idleError.message}`);

  const { count: purgedFailures, error: failureError } = await runsToPurge()
    .eq("status", "failed")
    .lt("started_at", daysAgo(FAILURE_RETENTION_DAYS));

  if (failureError) {
    throw new Error(`could not purge failed runs: ${failureError.message}`);
  }

  const { count: purgedLedger, error: ledgerError } = await db
    .from("background_job_run")
    .delete({ count: "exact" })
    .eq("status", "succeeded")
    .lt("finished_at", daysAgo(LEDGER_SUCCESS_RETENTION_DAYS));

  if (ledgerError) throw new Error(`could not purge job records: ${ledgerError.message}`);

  const { count: purgedLedgerFailures, error: ledgerFailureError } = await db
    .from("background_job_run")
    .delete({ count: "exact" })
    .eq("status", "failed")
    .lt("finished_at", daysAgo(LEDGER_FAILURE_RETENTION_DAYS));

  if (ledgerFailureError) {
    throw new Error(`could not purge failed job records: ${ledgerFailureError.message}`);
  }

  const { data: purgedDeliveries, error: deliveryError } = await db
    .from("email_delivery")
    .delete()
    .in("status", ["sent", "suppressed"])
    .lt("created_at", daysAgo(DELIVERY_RETENTION_DAYS))
    .select("id");

  if (deliveryError) {
    throw new Error(`could not purge deliveries: ${deliveryError.message}`);
  }

  // Rate-limit windows are only meaningful while they are open.
  const { data: purgedCounters, error: counterError } = await db
    .from("rate_limit_counter")
    .delete()
    .lt("window_start", daysAgo(1))
    .select("bucket");

  if (counterError) {
    throw new Error(`could not purge rate-limit counters: ${counterError.message}`);
  }

  const runs = (purgedRuns ?? 0) + (purgedIdle ?? 0) + (purgedFailures ?? 0);
  const ledger = (purgedLedger ?? 0) + (purgedLedgerFailures ?? 0);
  const deliveries = (purgedDeliveries ?? []).length;
  const counters = (purgedCounters ?? []).length;

  return {
    processed: runs + ledger + deliveries + counters,
    failed: 0,
    metadata: { runs, ledger, deliveries, counters },
  };
}
