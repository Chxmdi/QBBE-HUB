import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { mapVmsSnapshot } from "@/features/admin/services/vms";
import { recordJobRun } from "@/lib/job-observability";
import type { JobContext, JobResult } from "../runner";

/**
 * Refreshes VMS-owned identity/availability plus minimal assignment references.
 *
 * QBBE Hub never turns a VMS assignment into a Hub task and never lets a VMS
 * disconnect delete Hub work/history. The provider boundary is a normalized
 * snapshot, and only explicitly linked active organization members are touched.
 */
interface ConnectionRow {
  id: string;
  organization_id: string;
}

const REQUEST_TIMEOUT_MS = 12_000;

export async function vmsSync({ db, now }: JobContext): Promise<JobResult> {
  const endpoint = process.env.VMS_API_URL;
  if (!endpoint) {
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
  let updatedProfiles = 0;
  let assignmentRefs = 0;
  let removedAssignmentRefs = 0;
  let failed = 0;

  for (const connection of (connections ?? []) as unknown as ConnectionRow[]) {
    const startedAt = new Date().toISOString();
    let profilesForConnection = 0;
    let assignmentsForConnection = 0;
    let removedForConnection = 0;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.VMS_API_KEY) headers.Authorization = `Bearer ${process.env.VMS_API_KEY}`;

      const response = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`VMS responded ${response.status}.`);

      const snapshot = mapVmsSnapshot(await response.json());
      if (!snapshot.recognized) throw new Error("Unexpected VMS provider response shape.");

      const { data: members, error: memberError } = await db
        .from("organization_membership")
        .select("user_id")
        .eq("organization_id", connection.organization_id)
        .eq("status", "active");
      if (memberError) throw new Error(`Could not load organization members: ${memberError.message}`);

      const memberIds = ((members ?? []) as { user_id: string }[]).map((row) => row.user_id);
      const { data: linkedProfiles, error: linkedError } = memberIds.length
        ? await db
            .from("user_profile")
            .select("id, vms_id")
            .in("id", memberIds)
            .not("vms_id", "is", null)
        : { data: [] as { id: string; vms_id: string | null }[], error: null };
      if (linkedError) throw new Error(`Could not load linked VMS identities: ${linkedError.message}`);

      const userByVms = new Map<string, string>();
      for (const profile of (linkedProfiles ?? []) as { id: string; vms_id: string | null }[]) {
        if (profile.vms_id) userByVms.set(profile.vms_id, profile.id);
      }

      for (const identity of snapshot.identities) {
        const userId = userByVms.get(identity.vmsId);
        if (!userId) continue;
        const { data: changed, error: updateError } = await db
          .from("user_profile")
          .update({
            vms_availability: identity.availability,
            vms_synced_at: now.toISOString(),
          })
          .eq("id", userId)
          .eq("vms_id", identity.vmsId)
          .select("id");
        if (updateError) throw new Error(`Could not update VMS availability: ${updateError.message}`);
        profilesForConnection += changed?.length ?? 0;
      }

      if (snapshot.assignmentsProvided) {
        const seenExternalIds = new Set<string>();
        const rows = snapshot.assignments.flatMap((assignment) => {
          const userId = userByVms.get(assignment.vmsId);
          if (!userId) return [];
          seenExternalIds.add(assignment.assignmentId);
          return [{
            organization_id: connection.organization_id,
            user_id: userId,
            external_assignment_id: assignment.assignmentId,
            title: assignment.title,
            status: assignment.status,
            starts_at: assignment.startsAt,
            ends_at: assignment.endsAt,
            source_url: assignment.sourceUrl,
            external_updated_at: assignment.updatedAt,
            last_seen_at: now.toISOString(),
            updated_at: now.toISOString(),
          }];
        });

        if (rows.length) {
          const { error: assignmentError } = await db
            .from("vms_assignment_reference")
            .upsert(rows, { onConflict: "organization_id,external_assignment_id" });
          if (assignmentError) {
            throw new Error(`Could not save VMS assignment references: ${assignmentError.message}`);
          }
          assignmentsForConnection = rows.length;
        }

        const { data: existingRefs, error: existingError } = await db
          .from("vms_assignment_reference")
          .select("id, external_assignment_id")
          .eq("organization_id", connection.organization_id);
        if (existingError) {
          throw new Error(`Could not load VMS assignment references: ${existingError.message}`);
        }

        const staleIds = (existingRefs ?? [])
          .filter((row) => !seenExternalIds.has(row.external_assignment_id as string))
          .map((row) => row.id as string);
        if (staleIds.length) {
          const { error: deleteError } = await db
            .from("vms_assignment_reference")
            .delete()
            .eq("organization_id", connection.organization_id)
            .in("id", staleIds);
          if (deleteError) throw new Error(`Could not reconcile removed VMS assignments: ${deleteError.message}`);
          removedForConnection = staleIds.length;
        }
      }

      const { error: connectionUpdateError } = await db
        .from("integration_connection")
        .update({
          status: "connected",
          last_error: null,
          last_sync_at: now.toISOString(),
        })
        .eq("id", connection.id);
      if (connectionUpdateError) {
        throw new Error(`Could not record VMS synchronization: ${connectionUpdateError.message}`);
      }

      updatedProfiles += profilesForConnection;
      assignmentRefs += assignmentsForConnection;
      removedAssignmentRefs += removedForConnection;
      synced += 1;

      await recordJobRun(db, {
        organizationId: connection.organization_id,
        jobName: "vms-sync",
        status: "succeeded",
        details: {
          connectionId: connection.id,
          updatedProfiles: profilesForConnection,
          assignmentReferences: assignmentsForConnection,
          removedAssignmentReferences: removedForConnection,
        },
        startedAt,
      });
    } catch (cause) {
      failed += 1;
      const message = cause instanceof Error ? cause.message : "VMS sync failed.";

      await db
        .from("integration_connection")
        .update({ status: classifyIntegrationFailure(message), last_error: message.slice(0, 1000) })
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
    metadata: {
      connections: (connections ?? []).length,
      updatedProfiles,
      assignmentReferences: assignmentRefs,
      removedAssignmentReferences: removedAssignmentRefs,
    },
  };
}
