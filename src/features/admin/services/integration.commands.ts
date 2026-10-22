"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { mapVmsSnapshot } from "@/features/admin/services/vms";
import { runJob } from "@/features/jobs/services/runner";
import {
  ZeffyApiError,
  ZeffyClient,
  ZeffyRateLimitedError,
  zeffyConfig,
} from "@/features/zeffy/client";
import { getT } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";

/** Organization-wide integrations an administrator connects for everyone. */
const ORGANIZATION_PROVIDERS = new Set(["volunteer_system", "zeffy"]);

export async function disconnectIntegration(
  provider: "gmail" | "google_calendar" | "google_drive" | "volunteer_system" | "zeffy",
): Promise<ActionResult> {
  const t = await getT();
  let session = await requireSession();
  if (ORGANIZATION_PROVIDERS.has(provider)) {
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

  // Zeffy keeps what it already copied: payments are financial records, and
  // supporters are CRM contacts the team may have worked with since.
  const scopedQuery = ORGANIZATION_PROVIDERS.has(provider)
    ? query.is("user_id", null)
    : query.eq("user_id", session.userId);
  const { data: disconnected, error } = await scopedQuery
    .select("id")
    .maybeSingle();

  if (error || !disconnected) return { ok: false, error: t("admin.errors.disconnectFailed") };

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
      return { ok: false, error: t("admin.errors.vmsCleanupFailed") };
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
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  if (!process.env.VMS_API_URL) {
    return {
      ok: false,
      error:
        t("admin.errors.vmsNotConfigured"),
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
        error: t("admin.errors.vmsResponded", { status: response.status }),
      };
    }
    const snapshot = mapVmsSnapshot(await response.json());
    if (!snapshot.recognized) {
      return {
        ok: false,
        error: t("admin.errors.vmsBadPayload"),
      };
    }
  } catch {
    return {
      ok: false,
      error: t("admin.errors.vmsUnreachable"),
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
      if (insertError) return { ok: false, error: t("admin.errors.vmsRecordFailed") };
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
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const normalized = vmsId.trim();
  if (normalized.length > 200) return { ok: false, error: t("admin.errors.vmsIdTooLong") };

  const supabase = await createSupabaseServerClient();
  const { data: membership, error: membershipError } = await supabase
    .from("organization_membership")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !membership) {
    return { ok: false, error: t("admin.errors.vmsOnlyActive") };
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
  if (error || !updated) return { ok: false, error: t("admin.errors.vmsStoreFailed") };

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

function runZeffySyncAfterResponse(): void {
  after(async () => {
    try {
      const outcome = await runJob("zeffy-sync");
      if (outcome.status === "failed") {
        console.error("Zeffy sync failed", { runId: outcome.runId, error: outcome.error });
      }
    } catch (cause) {
      console.error("Zeffy sync could not start", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
}

/**
 * Connects this organization to Zeffy with the API key in ZEFFY_API_KEY. The
 * key is checked with one small read first, so a wrong key is reported here
 * rather than as a failed sync later. The first copy starts right away.
 */
export async function connectZeffy(): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const config = zeffyConfig();
  if (!config) return { ok: false, error: t("admin.errors.zeffyNotConfigured") };

  try {
    await new ZeffyClient(config).listPage("campaigns", { limit: 1 });
  } catch (cause) {
    if (cause instanceof ZeffyRateLimitedError) return { ok: false, error: t("admin.errors.zeffyBusy") };
    if (cause instanceof ZeffyApiError && (cause.status === 401 || cause.status === 403)) {
      return { ok: false, error: t("admin.errors.zeffyKeyRejected", { status: cause.status }) };
    }
    if (cause instanceof ZeffyApiError && cause.status > 0) {
      return { ok: false, error: t("admin.errors.zeffyResponded", { status: cause.status }) };
    }
    return { ok: false, error: t("admin.errors.zeffyUnreachable") };
  }

  const supabase = await createSupabaseServerClient();
  const fields = { status: "connected", last_error: null, last_sync_at: null };
  const { data: updated, error: updateError } = await supabase
    .from("integration_connection")
    .update(fields)
    .eq("organization_id", session.organizationId)
    .eq("provider", "zeffy")
    .is("user_id", null)
    .select("id");
  let error = updateError;
  if (!error && !(updated ?? []).length) {
    ({ error } = await supabase.from("integration_connection").insert({
      organization_id: session.organizationId,
      user_id: null,
      provider: "zeffy",
      ...fields,
    }));
  }
  if (error) {
    // The single-organization index: another organization holds the key.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: t("admin.errors.zeffyOtherOrganization") };
    }
    return { ok: false, error: t("admin.errors.zeffyRecordFailed") };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "integration",
    action: "zeffy_connected",
    object_type: "integration_connection",
  });
  runZeffySyncAfterResponse();
  revalidatePath("/admin");
  return { ok: true };
}

/** Runs the Zeffy sync now instead of at the next quarter hour. */
export async function syncZeffyNow(): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  if (!zeffyConfig()) return { ok: false, error: t("admin.errors.zeffyNotConfigured") };
  const limited = await enforceRateLimit("zeffy:sync", session.userId);
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  const { data: connection } = await supabase
    .from("integration_connection")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("provider", "zeffy")
    .is("user_id", null)
    .neq("status", "disconnected")
    .maybeSingle();
  if (!connection) return { ok: false, error: t("admin.errors.zeffyNotConnected") };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "integration",
    action: "zeffy_sync_requested",
    object_type: "integration_connection",
  });
  runZeffySyncAfterResponse();
  revalidatePath("/admin");
  return { ok: true };
}
