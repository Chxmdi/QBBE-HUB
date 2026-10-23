"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { logActionFailure } from "@/lib/server-log";

// A person corrects their own name and title in Settings; an administrator
// with MFA corrects a member's through public.rectify_member_profile, which
// records the change in the audit trail. Email and the volunteer-system
// identity are not editable here (the database refuses them).

function nameSchema(t: TranslateFn) {
  return z.object({
    fullName: requiredText(t("settings.profile.nameRequired"), 120),
    title: z.string().trim().max(120).optional(),
  });
}

export async function updateOwnProfile(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = nameSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("settings.profile.saveFailed") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_profile")
    .update({ full_name: parsed.data.fullName, title: parsed.data.title || null })
    .eq("id", session.userId)
    .select("id");
  if (error || !data?.length) {
    if (error) logActionFailure("profile.updateOwnProfile", error);
    return { ok: false, error: t("settings.profile.saveFailed") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rectifyMemberProfile(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const t = await getT();
  const parsed = nameSchema(t)
    .extend({ userId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("people.rectify.failed") };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("rectify_member_profile", {
    p_org: authorization.session.organizationId,
    p_user: parsed.data.userId,
    p_full_name: parsed.data.fullName,
    p_title: parsed.data.title ?? "",
  });
  if (error) {
    return {
      ok: false,
      error: error.code === "42501" ? t("people.rectify.otherOrganization") : t("people.rectify.failed"),
    };
  }
  revalidatePath(`/people/${parsed.data.userId}/work`);
  revalidatePath("/people");
  return { ok: true };
}
