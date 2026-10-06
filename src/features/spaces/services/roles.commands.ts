"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { workspaceCapabilities } from "@/lib/objects/contracts";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSpacesT } from "../i18n";
import { bitsFromCapabilities, roleKeyFromName } from "./roles";
import type { SpaceActionState } from "./spaces.commands";

const name = z.string().trim().min(1).max(80);
const roleSchema = z.object({
  nameEn: name,
  nameFr: name,
  capabilities: z.array(z.enum(workspaceCapabilities)).min(1),
});

function readRole(form: FormData) {
  return roleSchema.safeParse({
    nameEn: form.get("nameEn") ?? "",
    nameFr: form.get("nameFr") ?? "",
    capabilities: form.getAll("capabilities").map(String),
  });
}

async function guard() {
  const t = await getSpacesT();
  if (!(await isEnabled("wos_spaces"))) return { t, error: t("errors.failed") } as const;
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { t, error: t("roles.errors.forbidden") } as const;
  return { t, session: authorization.session } as const;
}

/** Owners and admins define roles; the database checks it again (RLS). */
export async function createRole(_previous: SpaceActionState, form: FormData): Promise<SpaceActionState> {
  const checked = await guard();
  if ("error" in checked) return { ok: false, message: checked.error ?? null };
  const { t, session } = checked;
  const parsed = readRole(form);
  if (!parsed.success) return { ok: false, message: t("roles.errors.invalid") };

  const db = await createSupabaseServerClient();
  const { error } = await db.from("access_role").insert({
    organization_id: session.organizationId,
    key: roleKeyFromName(parsed.data.nameEn, crypto.randomUUID()),
    name_en: parsed.data.nameEn,
    name_fr: parsed.data.nameFr,
    caps: bitsFromCapabilities(parsed.data.capabilities),
  });
  if (error) return { ok: false, message: t("roles.errors.failed") };
  revalidatePath("/spaces/roles");
  return { ok: true, message: t("roles.created") };
}

export async function updateRole(_previous: SpaceActionState, form: FormData): Promise<SpaceActionState> {
  const checked = await guard();
  if ("error" in checked) return { ok: false, message: checked.error ?? null };
  const { t } = checked;
  const id = z.string().uuid().safeParse(form.get("roleId"));
  const parsed = readRole(form);
  if (!id.success || !parsed.success) return { ok: false, message: t("roles.errors.invalid") };

  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("access_role")
    .update({
      name_en: parsed.data.nameEn,
      name_fr: parsed.data.nameFr,
      caps: bitsFromCapabilities(parsed.data.capabilities),
    })
    .eq("id", id.data)
    .eq("builtin", false)
    .select("id");
  if (error || !data?.length) return { ok: false, message: t("roles.errors.failed") };
  revalidatePath("/spaces/roles");
  return { ok: true, message: t("roles.saved") };
}

export async function deleteRole(_previous: SpaceActionState, form: FormData): Promise<SpaceActionState> {
  const checked = await guard();
  if ("error" in checked) return { ok: false, message: checked.error ?? null };
  const { t } = checked;
  const id = z.string().uuid().safeParse(form.get("roleId"));
  if (!id.success) return { ok: false, message: t("roles.errors.invalid") };

  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("access_role").delete().eq("id", id.data).eq("builtin", false).select("id");
  if (error) {
    return { ok: false, message: error.code === "23503" ? t("roles.errors.inUse") : t("roles.errors.failed") };
  }
  if (!data?.length) return { ok: false, message: t("roles.errors.failed") };
  revalidatePath("/spaces/roles");
  return { ok: true, message: t("roles.deleted") };
}
