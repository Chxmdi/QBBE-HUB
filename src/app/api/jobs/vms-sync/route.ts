import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { mapVmsIdentities } from "@/features/admin/services/vms";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { recordJobRun } from "@/lib/job-observability";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return POST(request); }

/** Refreshes availability for explicitly linked profiles; the VMS owns source data. */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.VMS_API_URL) return NextResponse.json({ error: "VMS_API_URL is not configured." }, { status: 503 });
  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }
  const { data: connections, error: connectionError } = await supabase.from("integration_connection").select("id, organization_id")
    .eq("provider", "volunteer_system").eq("status", "connected").is("user_id", null);
  if (connectionError) {
    console.error("VMS sync could not load integration connections", { error: connectionError.message });
    return NextResponse.json({ error: "Could not load VMS integration connections." }, { status: 500 });
  }
  let synced = 0; let failed = 0; let updated = 0;
  for (const connection of connections ?? []) {
    const startedAt = new Date().toISOString();
    let updatedForConnection = 0;
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (process.env.VMS_API_KEY) headers.Authorization = `Bearer ${process.env.VMS_API_KEY}`;
      const response = await fetch(process.env.VMS_API_URL, { headers, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`VMS responded ${response.status}.`);
      const identities = mapVmsIdentities(await response.json());
      const { data: members, error: memberError } = await supabase.from("organization_membership")
        .select("user_id")
        .eq("organization_id", connection.organization_id)
        .eq("status", "active");
      if (memberError) throw new Error(`Could not load organization members: ${memberError.message}`);
      const memberIds = (members ?? []).map((member) => member.user_id);
      for (const identity of identities) {
        if (memberIds.length === 0) continue;
        const { data: changedProfiles, error } = await supabase.from("user_profile")
          .update({ vms_availability: identity.availability, vms_synced_at: new Date().toISOString() })
          .in("id", memberIds)
          .eq("vms_id", identity.vmsId)
          .select("id");
        if (error) throw new Error(`Could not update VMS availability: ${error.message}`);
        const changed = changedProfiles?.length ?? 0;
        updated += changed;
        updatedForConnection += changed;
      }
      await supabase.from("integration_connection").update({ status: "connected", last_error: null, last_sync_at: new Date().toISOString() }).eq("id", connection.id);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "vms_sync",
        status: "succeeded",
        details: { connectionId: connection.id, updatedProfiles: updatedForConnection },
        startedAt,
      });
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "VMS sync failed.";
      console.error("VMS synchronization failed", { connectionId: connection.id, error: message });
      await supabase.from("integration_connection").update({ status: classifyIntegrationFailure(message), last_error: message }).eq("id", connection.id);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "vms_sync",
        status: "failed",
        details: { connectionId: connection.id },
        error: message,
        startedAt,
      });
      failed += 1;
    }
  }
  return NextResponse.json({ ok: true, synced, updated, failed });
}
