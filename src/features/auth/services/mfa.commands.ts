"use server";

import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { logActionFailure } from "@/lib/server-log";
import { recordAuditId } from "@/lib/audit-write";

const eventSchema = z.enum([
  "mfa_enrollment_completed",
  "mfa_challenge_completed",
  "mfa_factor_removed",
]);

/**
 * Mirrors successful MFA lifecycle events into the workspace audit trail.
 * Supabase Auth remains authoritative for provider attempts and failures; this
 * action records only a success that the server can independently confirm is
 * backed by a current, non-stale AAL2 session.
 */
export async function recordMfaSecurityEvent(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("auth.mfa.audit.invalidEvent") };

  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const supabase = await createSupabaseServerClient();

  const { data: recent, error: recentError } = await supabase
    .from("audit_event")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("actor_id", session.userId)
    .eq("action", parsed.data)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recentError) {
    logActionFailure("mfa.recordMfaSecurityEvent", recentError);
    return { ok: false, error: t("auth.mfa.audit.verifyFailed") };
  }
  if (recent) return { ok: true, id: recent.id as string };

  const id = await recordAuditId(supabase, {
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "security",
    action: parsed.data,
    object_type: "user_profile",
    object_id: session.userId,
    metadata: { assurance_level: "aal2" },
  });
  if (!id) return { ok: false, error: t("auth.mfa.audit.recordFailed") };
  return { ok: true, id };
}
