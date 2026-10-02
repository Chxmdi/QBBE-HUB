"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { loadActivityPage, type ActivityPage } from "./activity.queries";

const requestSchema = z.object({
  objectId: z.string().uuid(),
  before: z
    .object({
      at: z.string().min(10).max(40).regex(/^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)$/),
      seq: z.number().int().positive(),
    })
    .nullable(),
});

/**
 * Wave 2 C2: the next page of an object's activity (first page on "Try
 * again", older pages on "Show older activity"). Refused while either of the
 * unit's switches is off. Read-only, and read as the signed-in person, so
 * RLS on activity_entry decides what comes back.
 */
export async function loadActivity(input: unknown): Promise<ActivityPage> {
  const session = await requireSession();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const [pagesOn, objectsOn] = await Promise.all([isEnabled("wos_pages"), isEnabled("wos_objects")]);
  if (!pagesOn || !objectsOn) return { ok: false };
  try {
    return await loadActivityPage(parsed.data.objectId, await getLocale(), session.timeZone, parsed.data.before);
  } catch {
    return { ok: false };
  }
}
