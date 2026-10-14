import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { ZeffyClient, ZeffyRateLimitedError, zeffyConfig } from "@/features/zeffy/client";
import { syncOrganization } from "@/features/zeffy/sync";
import { recordJobRun } from "@/lib/job-observability";
import type { JobContext, JobResult } from "../runner";

/**
 * Copies Zeffy payments, supporters and campaigns into the Hub, every 15
 * minutes, for the organization connected in Admin > Integrations.
 *
 * Each run stays well inside Zeffy's limit of 100 requests a minute and
 * inside the job's time, and saves its place after every page: the first
 * copy of a large account simply takes several runs.
 */

/** Connections worth trying again. An expired key waits for an admin. */
export const ZEFFY_SYNCABLE_STATUSES = ["connected", "synchronization_delayed", "degraded"];

const REQUESTS_PER_RUN = 60;
const RUN_SECONDS = 40;

interface ConnectionRow {
  id: string;
  organization_id: string;
}

export async function zeffySync({ db, now }: JobContext): Promise<JobResult> {
  const config = zeffyConfig();
  if (!config) {
    return { processed: 0, failed: 0, metadata: { skipped: "ZEFFY_API_KEY is not set" } };
  }

  const { data: connections, error } = await db
    .from("integration_connection")
    .select("id, organization_id")
    .eq("provider", "zeffy")
    .is("user_id", null)
    .in("status", ZEFFY_SYNCABLE_STATUSES);
  if (error) throw new Error(`could not load Zeffy connections: ${error.message}`);

  let synced = 0;
  let failed = 0;
  const details: Record<string, unknown>[] = [];

  for (const connection of (connections ?? []) as ConnectionRow[]) {
    const startedAt = new Date().toISOString();
    const client = new ZeffyClient(config);
    try {
      const outcome = await syncOrganization(
        { db, organizationId: connection.organization_id, now },
        client,
        { maxRequests: REQUESTS_PER_RUN, deadline: Date.now() + RUN_SECONDS * 1000 },
      );
      const { error: updateError } = await db
        .from("integration_connection")
        .update({ status: "connected", last_error: null, last_sync_at: now.toISOString() })
        .eq("id", connection.id);
      if (updateError) throw new Error(`Could not record the Zeffy sync: ${updateError.message}`);

      synced += 1;
      details.push({ connectionId: connection.id, ...outcome });
      await recordJobRun(db, {
        organizationId: connection.organization_id,
        jobName: "zeffy-sync",
        status: "succeeded",
        details: { connectionId: connection.id, ...outcome },
        startedAt,
      });
    } catch (cause) {
      if (cause instanceof ZeffyRateLimitedError) {
        // Zeffy asked us to wait. What was read is saved; the next run resumes.
        synced += 1;
        details.push({ connectionId: connection.id, rateLimited: true, requests: client.requests });
        await recordJobRun(db, {
          organizationId: connection.organization_id,
          jobName: "zeffy-sync",
          status: "succeeded",
          details: { connectionId: connection.id, rateLimited: true, requests: client.requests },
          startedAt,
        });
        continue;
      }
      failed += 1;
      const message = cause instanceof Error ? cause.message : "Zeffy sync failed.";
      await db
        .from("integration_connection")
        .update({ status: classifyIntegrationFailure(message), last_error: message.slice(0, 1000) })
        .eq("id", connection.id);
      await recordJobRun(db, {
        organizationId: connection.organization_id,
        jobName: "zeffy-sync",
        status: "failed",
        details: { connectionId: connection.id, requests: client.requests },
        error: message,
        startedAt,
      });
    }
  }

  return { processed: synced, failed, metadata: { connections: details } };
}
