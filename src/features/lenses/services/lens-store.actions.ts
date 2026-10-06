"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseLensSpec } from "@/lib/query/run";
import { QueryError } from "@/lib/query/errors";
import { getLensT } from "@/features/lenses/i18n/server";
import { LENS_KINDS } from "./lens-store.types";

/**
 * Saving, sharing and deleting lenses (M8d). RLS lets people write only their
 * own lenses; these actions add validation and friendly errors on top.
 */

export interface LensActionResult {
  ok: boolean;
  id?: string;
  error?: string;
}

const layoutSchema = z
  .object({
    columns: z
      .array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), width: z.number().finite(), hidden: z.boolean() }).strict())
      .max(60)
      .optional(),
  })
  .strict();

const saveSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(LENS_KINDS),
    spec: z.unknown(),
    layout: layoutSchema.default({}),
    visibility: z.enum(["personal", "shared"]).default("personal"),
  })
  .strict();

const updateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    spec: z.unknown().optional(),
    layout: layoutSchema.optional(),
    visibility: z.enum(["personal", "shared"]).optional(),
  })
  .strict();

async function guard() {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  const enabled = await isEnabled("wos_lenses", supabase);
  return { session, t, supabase, enabled };
}

export async function saveLens(input: unknown): Promise<LensActionResult> {
  const { session, t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("saved.failed") };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("saved.invalid") };
  let spec;
  try {
    spec = parseLensSpec(parsed.data.spec);
  } catch (error) {
    return { ok: false, error: error instanceof QueryError ? t("saved.invalid") : t("saved.failed") };
  }
  const { data, error } = await supabase
    .from("lens")
    .insert({
      organization_id: session.organizationId,
      owner_id: session.userId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      type_key: spec.type,
      spec,
      layout: parsed.data.layout,
      visibility: parsed.data.visibility,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: t("saved.failed") };
  revalidatePath("/lenses");
  return { ok: true, id: data.id as string };
}

export async function updateLens(input: unknown): Promise<LensActionResult> {
  const { t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("saved.failed") };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("saved.invalid") };
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;
  if (parsed.data.layout !== undefined) patch.layout = parsed.data.layout;
  if (parsed.data.spec !== undefined) {
    try {
      const spec = parseLensSpec(parsed.data.spec);
      patch.spec = spec;
      patch.type_key = spec.type;
    } catch {
      return { ok: false, error: t("saved.invalid") };
    }
  }
  // RLS limits this to the viewer's own lens; zero rows means it is not theirs.
  const { data, error } = await supabase.from("lens").update(patch).eq("id", parsed.data.id).select("id");
  if (error || !data?.length) return { ok: false, error: t("saved.notYours") };
  revalidatePath("/lenses");
  return { ok: true, id: parsed.data.id };
}

export async function deleteLens(id: string): Promise<LensActionResult> {
  const { t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("saved.failed") };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: t("saved.invalid") };
  const { data, error } = await supabase.from("lens").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: t("saved.notYours") };
  revalidatePath("/lenses");
  return { ok: true };
}
