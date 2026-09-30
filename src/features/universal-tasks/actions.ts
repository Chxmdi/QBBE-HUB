"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUniversalTask } from "./create-task";
import { universalTasksT } from "./i18n";

export interface CreateTaskFromSourceResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * "Make a task from this" for any source (M7a): documents, comments,
 * workflows, the capture inbox and the command palette call this; the older
 * doors (task form, meetings, messages, CRM, templates) reach the same shared
 * action through their own commands.
 */
export async function createTaskFromSource(input: unknown): Promise<CreateTaskFromSourceResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("task:create", session.userId);
  if (limited) return limited;
  const t = universalTasksT(await getLocale());

  const supabase = await createSupabaseServerClient();
  const created = await createUniversalTask(
    supabase,
    {
      userId: session.userId,
      organizationId: session.organizationId,
      displayName: session.profile.full_name,
    },
    (input ?? {}) as Parameters<typeof createUniversalTask>[2],
  );
  if (!created.ok) {
    const key =
      created.reason === "invalid"
        ? "errors.invalid"
        : created.reason === "source"
          ? "errors.sourceNotFound"
          : "errors.saveFailed";
    return { ok: false, error: t(key) };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: created.id };
}
