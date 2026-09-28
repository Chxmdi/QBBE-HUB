"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { getFormatters, getT } from "@/lib/i18n/server";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  localizeSubject,
  policyIsAllowed,
  savePolicySchema,
  type RetentionSubject,
} from "@/features/retention/schemas";

/**
 * Setting what the organization keeps.
 *
 * `requireAdmin` here is not the boundary — `retention_policy_manage` is — but
 * it is worth having anyway: this is one of the few surfaces where the answer
 * to "why can't I do this" should be a clear sentence rather than a row that
 * quietly fails to save.
 *
 * The floor is checked twice on purpose. Once here against the subject's own
 * row, so the message names the record type and the minimum; and once in the
 * database trigger, which is what actually holds when this code is wrong.
 */
export async function saveRetentionPolicy(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const t = await getT();
  const format = await getFormatters();
  const parsed = savePolicySchema.safeParse(input);
  if (!parsed.success) {
    // The schema's English sentences are the English catalogue values, so each
    // finds its key; anything else (zod's own defaults) falls through as-is.
    const message = parsed.error.issues[0]?.message;
    if (!message) return { ok: false, error: t("retention.errors.invalidInput") };
    const key = Object.entries(opsEn.retention.errors).find(([, text]) => text === message)?.[0];
    return { ok: false, error: key ? t(`retention.errors.${key}` as MessageKey) : message };
  }
  const { subjectKey, retainDays, action, enabled, note } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("retention_subject")
    .select("*")
    .eq("key", subjectKey)
    .maybeSingle();

  if (!subject) {
    return { ok: false, error: t("retention.errors.notGovernable") };
  }

  const allowed = policyIsAllowed(
    localizeSubject(subject as unknown as RetentionSubject, t),
    { retainDays, action },
    t,
    (value) => format.number(value),
  );
  if (!allowed.ok) return { ok: false, error: allowed.reason };

  const { error } = await supabase
    .from("retention_policy")
    .upsert(
      {
        organization_id: session.organizationId,
        subject_key: subjectKey,
        retain_days: retainDays,
        action,
        enabled,
        note: note || null,
        updated_by: session.userId,
        created_by: session.userId,
      },
      { onConflict: "organization_id,subject_key" },
    );

  if (error) {
    // The trigger's message names the subject and its floor, which is more
    // use than anything this function could substitute for it.
    return { ok: false, error: error.message };
  }

  // Retention is a governance decision, so it is auditable whether or not it
  // ever deletes anything.
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "governance",
    action: enabled ? "retention_policy_enabled" : "retention_policy_saved",
    object_type: "retention_policy",
    metadata: { subject_key: subjectKey, retain_days: retainDays, action },
  });

  revalidatePath("/admin/retention");
  return { ok: true };
}
