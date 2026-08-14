"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

export async function disconnectIntegration(
  provider: "gmail" | "google_calendar" | "volunteer_system",
): Promise<ActionResult> {
  const session = await requireSession();
  if (provider === "volunteer_system" && !session.isAdmin) {
    return { ok: false, error: "Admin access required." };
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

  const { error } =
    provider === "volunteer_system"
      ? await query.is("user_id", null)
      : await query.eq("user_id", session.userId);

  if (error) return { ok: false, error: "Could not disconnect." };

  if (provider === "gmail") {
    await supabase.from("gmail_message").delete().eq("user_id", session.userId);
  }
  if (provider === "google_calendar") {
    await supabase.from("calendar_event_link").delete().eq("user_id", session.userId);
  }
  if (provider === "volunteer_system") {
    const { error: clearError } = await supabase.rpc("clear_org_vms_ids");
    if (clearError) {
      await supabase.from("user_profile").update({ vms_id: null }).eq("id", session.userId);
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
  return { ok: true };
}

export async function connectVolunteerSystem(): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
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
      last_sync_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,provider,user_id" },
  );
  if (error) {
    // Unique index on (org, provider) WHERE user_id IS NULL may be the match.
    const { error: updateError } = await supabase
      .from("integration_connection")
      .update({ status: "connected", last_error: null, last_sync_at: new Date().toISOString() })
      .eq("organization_id", session.organizationId)
      .eq("provider", "volunteer_system")
      .is("user_id", null);
    if (updateError) {
      const { error: insertError } = await supabase.from("integration_connection").insert({
        organization_id: session.organizationId,
        provider: "volunteer_system",
        status: "connected",
        last_sync_at: new Date().toISOString(),
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
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ vms_id: vmsId.trim() || null })
    .eq("id", userId);
  if (error) return { ok: false, error: "Could not store the VMS id." };
  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}
