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
 * Dead-lettered queue messages are deliberately left alone: an administrator
 * should decide what happens to mail that never went out.
 */

const SUCCESS_RETENTION_DAYS = 30;
const FAILURE_RETENTION_DAYS = 180;
const DELIVERY_RETENTION_DAYS = 180;

export async function purgeJobHistory({ db, now }: JobContext): Promise<JobResult> {
  const successCutoff = new Date(
    now.getTime() - SUCCESS_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const failureCutoff = new Date(
    now.getTime() - FAILURE_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const deliveryCutoff = new Date(
    now.getTime() - DELIVERY_RETENTION_DAYS * 86_400_000,
  ).toISOString();

  const { data: purgedRuns, error: runError } = await db
    .from("job_run")
    .delete()
    .eq("status", "succeeded")
    .lt("started_at", successCutoff)
    .select("id");

  if (runError) throw new Error(`could not purge job runs: ${runError.message}`);

  const { data: purgedFailures, error: failureError } = await db
    .from("job_run")
    .delete()
    .eq("status", "failed")
    .lt("started_at", failureCutoff)
    .select("id");

  if (failureError) {
    throw new Error(`could not purge failed runs: ${failureError.message}`);
  }

  const { data: purgedDeliveries, error: deliveryError } = await db
    .from("email_delivery")
    .delete()
    .in("status", ["sent", "suppressed"])
    .lt("created_at", deliveryCutoff)
    .select("id");

  if (deliveryError) {
    throw new Error(`could not purge deliveries: ${deliveryError.message}`);
  }

  const runs = (purgedRuns ?? []).length + (purgedFailures ?? []).length;
  const deliveries = (purgedDeliveries ?? []).length;

  return {
    processed: runs + deliveries,
    failed: 0,
    metadata: { runs, deliveries },
  };
}
