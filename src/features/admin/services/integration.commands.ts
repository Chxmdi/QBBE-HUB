"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { mapVmsSnapshot } from "@/features/admin/services/vms";

export async function disconnectIntegration(
  provider: "gmail" | "google_calendar" | "google_drive" | "volunteer_system",
): Promise<ActionResult> {
  let session = await requireSession();
  if (provider === "volunteer_system") {
    const authorization = await authorizeAdminAction();
    if (!authorization.ok) return { ok: false, error: authorization.error };
    session = authorization.session;
  }
  const supabase = await createSupabaseServerClient();
  const query = supabase
    .from("integration_connection")
    .update({
      status: "disconnected",
      last_error: null,
      last_sync_at: null,
    })
    .eq("provider", provider)
    .eq("organization_id", session.organizationId);

  const scopedQuery = provider === "volunteer_system"
    ? query.is("user_id", null)
    : query.eq("user_id", session.userId);
  const { data: disconnected, error } = await scopedQuery
    .select("id")
    .maybeSingle();

  if (error || !disconnected) return { ok: false, error: "Could not disconnect." };

  if (provider === "gmail") {
    await supabase.from("gmail_message").delete().eq("user_id", session.userId);
  }
  if (provider === "google_calendar") {
    await supabase.from("calendar_event_link").delete().eq("user_id", session.userId);
  }
  if (provider === "google_drive") {
    const { data: connection } = await supabase
      .from("integration_connection")
      .select("id")
      .eq("organization_id", session.organizationId)
      .eq("provider", provider)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (connection) {
      await supabase.from("document").delete().eq("integration_connection_id", connection.id);
    }
  }
  if (provider === "volunteer_system") {
    await supabase
      .from("vms_assignment_reference")
      .delete()
      .eq("organization_id", session.organizationId);
    const { error: clearError } = await supabase.rpc("clear_org_vms_ids");
    if (clearError) {
      return { ok: false, error: "VMS disconnected, but linked identity cleanup failed." };
    }
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "integration",
    action: "integration_disconnected",
    object_type: "integration_connection",
    metadata: { provider },
  });

  revalidatePath("/admin");
  revalidatePath("/inbox");
  revalidatePath("/calendar");
  revalidatePath("/documents");
  return { ok: true };
}

export async function connectVolunteerSystem(): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  if (!process.env.VMS_API_URL) {
    return {
      ok: false,
      error:
        "Volunteer Management System is not configured. Set VMS_API_URL (and VMS_API_KEY) first.",
    };
  }
  try {
    const headers: Record<string, string> = {};
    if (process.env.VMS_API_KEY) {
      headers.Authorization = `Bearer ${process.env.VMS_API_KEY}`;
    }
    const response = await fetch(process.env.VMS_API_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `VMS responded ${response.status}. Connection was not recorded.`,
      };
    }
    const snapshot = mapVmsSnapshot(await response.json());
    if (!snapshot.recognized) {
      return {
        ok: false,
        error: "VMS responded, but its payload did not match the configured identity/assignment contract.",
      };
    }
  } catch {
    return {
      ok: false,
      error: "Could not reach the Volunteer Management System. Connection was not recorded.",
    };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("integration_connection").upsert(
    {
      organization_id: session.organizationId,
      user_id: null,
      provider: "volunteer_system",
      status: "connected",
      last_error: null,
      last_sync_at: null,
    },
    { onConflict: "organization_id,provider,user_id" },
  );
  if (error) {
    // Unique index on (org, provider) WHERE user_id IS NULL may be the match.
    const { error: updateError } = await supabase
      .from("integration_connection")
      .update({ status: "connected", last_error: null, last_sync_at: null })
      .eq("organization_id", session.organizationId)
      .eq("provider", "volunteer_system")
      .is("user_id", null);
    if (updateError) {
      const { error: insertError } = await supabase.from("integration_connection").insert({
        organization_id: session.organizationId,
        provider: "volunteer_system",
        status: "connected",
        last_sync_at: null,
      });
      if (insertError) return { ok: false, error: "Could not record the VMS connection." };
    }
  }
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "integration",
    action: "vms_connected",
    object_type: "integration_connection",
  });
  revalidatePath("/admin");
  return { ok: true };
}

export async function linkVmsIdentity(
  userId: string,
  vmsId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const normalized = vmsId.trim();
  if (normalized.length > 200) return { ok: false, error: "VMS id is too long." };

  const supabase = await createSupabaseServerClient();
  const { data: membership, error: membershipError } = await supabase
    .from("organization_membership")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership) {
    return { ok: false, error: "Only active members of this organization can be linked to VMS identities." };
  }

  const { data: updated, error } = await supabase
    .from("user_profile")
    .update({
      vms_id: normalized || null,
      vms_availability: "unknown",
      vms_synced_at: null,
    })
    .eq("id", userId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: "Could not store the VMS id." };

  if (!normalized) {
    await supabase
      .from("vms_assignment_reference")
      .delete()
      .eq("organization_id", session.organizationId)
      .eq("user_id", userId);
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "integration",
    action: normalized ? "vms_identity_linked" : "vms_identity_unlinked",
    object_type: "user_profile",
    object_id: userId,
    metadata: normalized ? { vms_id: normalized } : {},
  });

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}
