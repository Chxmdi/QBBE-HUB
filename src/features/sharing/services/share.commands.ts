"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSharingT } from "../i18n";
import { principalKinds } from "./share";

export interface ShareActionState {
  ok: boolean;
  message: string | null;
}

const orgRoles = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;

const shareSchema = z
  .object({
    objectId: z.string().uuid(),
    principalKind: z.enum(principalKinds),
    principalId: z.string().min(1),
    roleId: z.string().uuid(),
    includeInside: z.boolean(),
  })
  .refine((v) => (v.principalKind === "org_role" ? (orgRoles as readonly string[]).includes(v.principalId) : z.string().uuid().safeParse(v.principalId).success));

function failure(code: string | undefined, t: Awaited<ReturnType<typeof getSharingT>>): ShareActionState {
  if (code === "23505") return { ok: false, message: t("errors.duplicate") };
  if (code === "42501") return { ok: false, message: t("errors.forbidden") };
  return { ok: false, message: t("errors.failed") };
}

/**
 * Gives a person, team or organization role access to a space or page. The
 * database decides whether the caller may (access_grant_insert: share there,
 * and no more than they hold); nothing here widens that.
 */
export async function shareWith(_previous: ShareActionState, form: FormData): Promise<ShareActionState> {
  const t = await getSharingT();
  if (!(await isEnabled("wos_spaces"))) return { ok: false, message: t("errors.failed") };
  const session = await requireSession();
  const principalKind = String(form.get("principalKind") ?? "");
  const parsed = shareSchema.safeParse({
    objectId: form.get("objectId"),
    principalKind,
    principalId: form.get(`principal_${principalKind}`) ?? form.get("principalId") ?? "",
    roleId: form.get("roleId"),
    includeInside: form.get("includeInside") === "on",
  });
  if (!parsed.success) return { ok: false, message: t("errors.invalid") };
  const { objectId, principalId, roleId, includeInside } = parsed.data;

  const db = await createSupabaseServerClient();
  const { error } = await db.from("access_grant").insert({
    organization_id: session.organizationId,
    object_id: objectId,
    principal_kind: parsed.data.principalKind,
    user_id: parsed.data.principalKind === "person" ? principalId : null,
    team_id: parsed.data.principalKind === "team" ? principalId : null,
    org_role: parsed.data.principalKind === "org_role" ? principalId : null,
    role_id: roleId,
    reach: includeInside ? "subtree" : "self",
  });
  if (error) return failure(error.code, t);
  revalidatePath("/spaces", "layout");
  return { ok: true, message: t("done.added") };
}

const changeSchema = z.object({ grantId: z.string().uuid(), roleId: z.string().uuid() });

export async function changeGrant(_previous: ShareActionState, form: FormData): Promise<ShareActionState> {
  const t = await getSharingT();
  if (!(await isEnabled("wos_spaces"))) return { ok: false, message: t("errors.failed") };
  const parsed = changeSchema.safeParse({ grantId: form.get("grantId"), roleId: form.get("roleId") });
  if (!parsed.success) return { ok: false, message: t("errors.invalid") };
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("access_grant")
    .update({ role_id: parsed.data.roleId })
    .eq("id", parsed.data.grantId)
    .select("id");
  if (error) return failure(error.code, t);
  if (!data?.length) return { ok: false, message: t("errors.forbidden") };
  revalidatePath("/spaces", "layout");
  return { ok: true, message: t("done.saved") };
}

export async function removeGrant(_previous: ShareActionState, form: FormData): Promise<ShareActionState> {
  const t = await getSharingT();
  if (!(await isEnabled("wos_spaces"))) return { ok: false, message: t("errors.failed") };
  const grantId = z.string().uuid().safeParse(form.get("grantId"));
  if (!grantId.success) return { ok: false, message: t("errors.invalid") };
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("access_grant").delete().eq("id", grantId.data).select("id");
  if (error) return failure(error.code, t);
  if (!data?.length) return { ok: false, message: t("errors.forbidden") };
  revalidatePath("/spaces", "layout");
  return { ok: true, message: t("done.removed") };
}
