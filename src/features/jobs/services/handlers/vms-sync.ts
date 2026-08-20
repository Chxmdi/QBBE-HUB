import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { mapVmsIdentities } from "@/features/admin/services/vms";
import { recordJobRun } from "@/lib/job-observability";
import type { JobContext, JobResult } from "../runner";

/**
 * Refreshes volunteer availability from the Volunteer Management System.
 *
 * The VMS owns the source data; the Hub stores only a linked external id and
 * the current availability needed for assignment decisions. Only profiles that
 * were explicitly linked are touched, and only within the organization that
 * owns the connection — a VMS response can never reach across a tenancy
 * boundary.
 *
 * A failure marks the connection, so Admin → Integrations shows a degraded
 * state instead of a silently stale one.
 */

interface ConnectionRow {
  id: string;
  organization_id: string;
}

const REQUEST_TIMEOUT_MS = 12_000;

export async function vmsSync({ db, now }: JobContext): Promise<JobResult> {
  const endpoint = process.env.VMS_API_URL;
  if (!endpoint) {
    // Not configured is not a failure: the integration is simply off.
    return { processed: 0, failed: 0, metadata: { skipped: "VMS_API_URL is not set" } };
  }

  const { data: connections, error } = await db
    .from("integration_connection")
    .select("id, organization_id")
    .eq("provider", "volunteer_system")
    .eq("status", "connected")
    .is("user_id", null);

  if (error) throw new Error(`could not load VMS connections: ${error.message}`);

  let synced = 0;
  let updated = 0;
  let failed = 0;

  for (const connection of (connections ?? []) as unknown as ConnectionRow[]) {
    const startedAt = new Date().toISOString();
    let updatedForConnection = 0;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.VMS_API_KEY) {
        headers.Authorization = `Bearer ${process.env.VMS_API_KEY}`;
      }

      const response = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`VMS responded ${response.status}.`);

      const identities = mapVmsIdentities(await response.json());

      const { data: members, error: memberError } = await db
        .from("organization_membership")
        .select("user_id")
        .eq("organization_id", connection.organization_id)
        .eq("status", "active");
      if (memberError) {
        throw new Error(`Could not load organization members: ${memberError.message}`);
      }

      const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);

      for (const identity of identities) {
        if (memberIds.length === 0) break;
        const { data: changed, error: updateError } = await db
          .from("user_profile")
          .update({
            vms_availability: identity.availability,
            vms_synced_at: now.toISOString(),
          })
          .in("id", memberIds)
          .eq("vms_id", identity.vmsId)
          .select("id");
        if (updateError) {
          throw new Error(`Could not update VMS availability: ${updateError.message}`);
        }
        updatedForConnection += changed?.length ?? 0;
      }

      updated += updatedForConnection;
      synced += 1;

      await db
        .from("integration_connection")
        .update({
          status: "connected",
          last_error: null,
          last_sync_at: now.toISOString(),
        })
        .eq("id", connection.id);

      await recordJobRun(db, {
        organizationId: connection.organization_id,
        jobName: "vms-sync",
        status: "succeeded",
        details: { connectionId: connection.id, updatedProfiles: updatedForConnection },
        startedAt,
      });
    } catch (cause) {
      failed += 1;
      const message = cause instanceof Error ? cause.message : "VMS sync failed.";

      await db
        .from("integration_connection")
        .update({ status: classifyIntegrationFailure(message), last_error: message })
        .eq("id", connection.id);

      await recordJobRun(db, {
        organizationId: connection.organization_id,
        jobName: "vms-sync",
        status: "failed",
        details: { connectionId: connection.id },
        error: message,
        startedAt,
      });
    }
  }

  return {
    processed: synced,
    failed,
    metadata: { connections: (connections ?? []).length, updatedProfiles: updated },
  };
}
