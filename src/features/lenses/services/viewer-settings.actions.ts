"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseLensSpec } from "@/lib/query/run";
import { getLensT } from "@/features/lenses/i18n/server";

/**
 * One viewer's own columns, sort and filters on a lens (U13, table
 * lens_viewer_setting). A shared lens is never changed from here: the row
 * belongs to the viewer, and RLS lets them read and write only their own
 * row, only for a lens they can read.
 *
 * No rate limit on purpose: a save is an upsert of one bounded row per lens
 * and viewer (the table caps every column's size and the primary key caps
 * the count), it writes nothing anyone else can see, and the table debounces
 * it. The limiter's keys are fixed; none of them describes this, and a
 * borrowed one would throttle unrelated work.
 */

export interface ViewerSettingResult {
  ok: boolean;
  error?: string;
}

export interface LoadedViewerSetting {
  layout: Record<string, unknown>;
  sort: unknown;
  where: unknown;
}

const UUID = z.string().uuid();

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
    lensId: UUID,
    layout: layoutSchema.default({}),
    sort: z.array(z.object({ property: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), direction: z.enum(["asc", "desc"]) }).strict()).max(3).default([]),
    /** The builder's where clause; null clears it; absent keeps the lens's own. */
    where: z.unknown().optional(),
  })
  .strict();

async function guard() {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  const enabled = await isEnabled("wos_lenses", supabase);
  return { session, t, supabase, enabled };
}

/** The viewer's setting for a lens, or null when there is none (or it cannot be read). */
export async function loadViewerSetting(lensId: string): Promise<LoadedViewerSetting | null> {
  const { supabase, enabled } = await guard();
  if (!enabled || !UUID.safeParse(lensId).success) return null;
  const { data, error } = await supabase
    .from("lens_viewer_setting")
    .select("layout, sort, where")
    .eq("lens_id", lensId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { layout: Record<string, unknown> | null; sort: unknown; where: unknown };
  return { layout: row.layout ?? {}, sort: row.sort ?? [], where: row.where ?? null };
}

export async function saveViewerSetting(input: unknown): Promise<ViewerSettingResult> {
  const { session, t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("viewer.failed") };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("viewer.invalid") };

  // The lens must be readable (RLS decides), and its type says what the
  // where clause and sort may name.
  const { data: lens } = await supabase.from("lens").select("type_key").eq("id", parsed.data.lensId).maybeSingle();
  if (!lens) return { ok: false, error: t("viewer.failed") };
  const where = parsed.data.where ?? undefined;
  try {
    parseLensSpec({
      version: 1,
      type: (lens as { type_key: string | null }).type_key ?? "task",
      ...(where === null ? {} : { where }),
      sort: parsed.data.sort,
    });
  } catch {
    return { ok: false, error: t("viewer.invalid") };
  }

  const { error } = await supabase.from("lens_viewer_setting").upsert(
    {
      lens_id: parsed.data.lensId,
      user_id: session.userId,
      layout: parsed.data.layout,
      sort: parsed.data.sort,
      where: where ?? null,
    },
    { onConflict: "lens_id,user_id" },
  );
  if (error) return { ok: false, error: t("viewer.failed") };
  return { ok: true };
}

/** Back to the lens as its owner saved it: the viewer's row is removed. */
export async function clearViewerSetting(lensId: string): Promise<ViewerSettingResult> {
  const { session, t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("viewer.failed") };
  if (!UUID.safeParse(lensId).success) return { ok: false, error: t("viewer.invalid") };
  const { error } = await supabase.from("lens_viewer_setting").delete().eq("lens_id", lensId).eq("user_id", session.userId);
  if (error) return { ok: false, error: t("viewer.failed") };
  return { ok: true };
}
