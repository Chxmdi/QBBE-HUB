"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { layoutSchema, normalizeLayout } from "../layout";
import { layoutsText } from "../messages";
import { layoutCatalog } from "./layout.catalog";

export interface LayoutResult {
  ok: boolean;
  error?: string;
}

const saveSchema = z.object({ typeId: z.string().uuid(), layout: layoutSchema });

/** Saves a type's layout (owners and admins; RLS decides). */
export async function saveObjectLayout(input: unknown): Promise<LayoutResult> {
  const session = await requireSession();
  const m = layoutsText(await getLocale()).errors;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.invalid };
  const db = await createSupabaseServerClient();
  const { data: type } = await db.from("object_type").select("id, key").eq("id", parsed.data.typeId).maybeSingle();
  if (!type) return { ok: false, error: m.failed };
  const layout = normalizeLayout(parsed.data.layout, await layoutCatalog(type.key as string));
  const { error } = await db
    .from("object_layout")
    .upsert({ organization_id: session.organizationId, type_id: type.id, layout }, { onConflict: "type_id" });
  if (error) return { ok: false, error: error.message.includes("row-level security") ? m.forbidden : m.failed };
  revalidatePath("/collab/layouts", "layout");
  return { ok: true };
}

/** Removes a type's custom layout, going back to the standard one. */
export async function resetObjectLayout(typeId: unknown): Promise<LayoutResult> {
  await requireSession();
  const m = layoutsText(await getLocale()).errors;
  const id = z.string().uuid().safeParse(typeId);
  if (!id.success) return { ok: false, error: m.failed };
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("object_layout").delete().eq("type_id", id.data).select("id");
  if (error) return { ok: false, error: m.failed };
  if (!data || data.length === 0) return { ok: false, error: m.forbidden };
  revalidatePath("/collab/layouts", "layout");
  return { ok: true };
}
