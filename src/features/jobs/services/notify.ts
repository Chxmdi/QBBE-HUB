import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creating notifications from a sweep job.
 *
 * Sweeps re-examine the same population every run, so almost every row they
 * would write already exists. `notification` carries an unconditional unique
 * constraint on (user_id, dedupe_key), which PostgREST can target directly —
 * so the whole batch goes in one statement and the duplicates are simply
 * ignored, rather than one duplicate failing the insert for everyone else.
 *
 * Rows without a dedupe key are not this function's business; PostgreSQL
 * treats NULLs as distinct, so they would never collide anyway.
 */

export interface NotificationDraft {
  user_id: string;
  organization_id: string;
  category: string;
  title: string;
  body?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  link?: string | null;
  urgency?: "low" | "normal" | "high" | "critical";
  dedupe_key: string;
}

const CHUNK = 200;

export async function createNotifications(
  db: SupabaseClient,
  drafts: NotificationDraft[],
): Promise<number> {
  let inserted = 0;

  for (let index = 0; index < drafts.length; index += CHUNK) {
    const chunk = drafts.slice(index, index + CHUNK);
    const { data, error } = await db
      .from("notification")
      .upsert(chunk, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
      .select("id");

    if (error) throw new Error(`could not create notifications: ${error.message}`);
    inserted += data?.length ?? 0;
  }

  return inserted;
}
