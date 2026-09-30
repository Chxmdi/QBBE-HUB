"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSpacesT } from "../i18n";
import { isOrgRole, parseSessionHours } from "./sign-in-rules";

export interface RuleActionState {
  ok: boolean;
  message: string | null;
}

/** Saves one role's sign-in rule. The database refuses turning MFA off for owners and admins. */
export async function saveSignInRule(_previous: RuleActionState, form: FormData): Promise<RuleActionState> {
  const t = await getSpacesT();
  if (!(await isEnabled("wos_spaces"))) return { ok: false, message: t("admin.errors.failed") };
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, message: t("admin.errors.forbidden") };
  const role = form.get("role");
  const hours = parseSessionHours(String(form.get("hours") ?? ""));
  if (!isOrgRole(role) || hours === "invalid") return { ok: false, message: t("admin.errors.invalid") };
  const requireMfa = role === "owner" || role === "admin" || form.get("requireMfa") === "on";

  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("sign_in_rule")
    .update({ require_mfa: requireMfa, max_session_hours: hours })
    .eq("organization_id", authorization.session.organizationId)
    .eq("role", role)
    .select("role");
  if (error || !data?.length) return { ok: false, message: t("admin.errors.failed") };
  revalidatePath("/spaces/admin");
  return { ok: true, message: t("admin.rules.saved") };
}
