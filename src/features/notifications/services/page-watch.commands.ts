"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPagesT } from "@/features/pages/i18n/server";

/**
 * Watching a page (wave 2, C3). The write runs as the signed-in person, so
 * page_watch's RLS decides: only your own watch, only on a page you can open.
 * Off unless the `wos_pages` switch is on.
 */

export interface PageWatchResult {
  ok: boolean;
  error?: string;
  watching?: boolean;
}

const watchSchema = z.object({ pageId: z.string().uuid(), watching: z.boolean() });

export async function setPageWatch(input: unknown): Promise<PageWatchResult> {
  const t = await getPagesT();
  if (!(await isEnabled("wos_pages"))) return { ok: false, error: t("units.c3.watch.notAllowed") };
  const session = await requireSession();
  const parsed = watchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("units.c3.watch.notAllowed") };
  // Watching is a subscription to someone else's content, like a share.
  const limited = await enforceRateLimit("share:write", session.userId);
  if (limited) return limited;

  const { pageId, watching } = parsed.data;
  const db = await createSupabaseServerClient();
  if (watching) {
    // A plain insert: RETURNING or ON CONFLICT would need the read policy too.
    const { error } = await db.from("page_watch").insert({ page_id: pageId, user_id: session.userId });
    // 23505: already watching, which is what was asked.
    if (error && error.code !== "23505") {
      return { ok: false, error: error.code === "42501" ? t("units.c3.watch.notAllowed") : t("units.c3.watch.failed") };
    }
  } else {
    const { error } = await db.from("page_watch").delete().eq("page_id", pageId).eq("user_id", session.userId);
    if (error) return { ok: false, error: t("units.c3.watch.failed") };
  }
  revalidatePath(`/pages/${pageId}`);
  return { ok: true, watching };
}
