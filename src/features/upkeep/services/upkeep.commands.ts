"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UPKEEP_FLAG } from "@/features/upkeep/gate";
import { upkeepText } from "@/features/upkeep/messages";

/**
 * An owner's review of a stale page: still current (resets its clock) or
 * archive. Archiving goes through the document table's own rules, as the
 * person; the review is then recorded (upkeep_review), which the database
 * only accepts from the owner or someone who manages the page.
 */
export async function reviewStalePage(
  objectType: "document" | "page",
  objectId: string,
  decision: "current" | "archive",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = upkeepText(await getLocale());
  if (!(await isEnabled(UPKEEP_FLAG))) return { ok: false, error: m.errors.forbidden };
  const session = await requireSession();
  if (!z.string().uuid().safeParse(objectId).success || !["document", "page"].includes(objectType)) {
    return { ok: false, error: m.errors.generic };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("upkeep_review")
    .insert({ organization_id: session.organizationId, object_type: objectType, object_id: objectId, decision });
  if (error) return { ok: false, error: error.code === "42501" ? m.errors.forbidden : m.errors.generic };
  if (decision === "archive" && objectType === "document") {
    const { data, error: archiveError } = await supabase
      .from("document")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", objectId)
      .select("id");
    if (archiveError || !data?.length) return { ok: false, error: m.errors.forbidden };
  }
  revalidatePath("/upkeep");
  return { ok: true };
}
