"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSpacesT } from "../i18n";

export interface SpaceActionState {
  ok: boolean;
  message: string | null;
}

const name = z.string().trim().min(1).max(120);
const createSpaceSchema = z.object({
  nameEn: name,
  nameFr: name,
  description: z.string().trim().max(2000).optional().transform((value) => value || null),
});

/**
 * Creates a custom space (Board, Admin, ...). The database decides who may:
 * `space_admin_create` requires an owner or admin with two-step sign-in in
 * this organization. The check here only gives a clearer message first.
 */
export async function createCustomSpace(
  _previous: SpaceActionState,
  form: FormData,
): Promise<SpaceActionState> {
  const t = await getSpacesT();
  if (!(await isEnabled("wos_spaces"))) return { ok: false, message: t("errors.failed") };
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, message: t("errors.forbidden") };

  const parsed = createSpaceSchema.safeParse({
    nameEn: form.get("nameEn") ?? "",
    nameFr: form.get("nameFr") ?? "",
    description: form.get("description") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: t("errors.invalid") };

  const db = await createSupabaseServerClient();
  const { error } = await db.from("space").insert({
    organization_id: authorization.session.organizationId,
    kind: "custom",
    name_en: parsed.data.nameEn,
    name_fr: parsed.data.nameFr,
    description: parsed.data.description,
  });
  if (error) {
    return { ok: false, message: error.code === "42501" ? t("errors.forbidden") : t("errors.failed") };
  }
  revalidatePath("/spaces");
  return { ok: true, message: t("create.created") };
}
