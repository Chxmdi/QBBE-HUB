import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creating notifications from a sweep job.
 *
 * Sweeps re-examine the same population every run, so almost every row they
 * would write already exists. `notification` has a unique index on
 * (user_id, dedupe_key), which is the correctness backstop — but a single bulk
 * insert containing one duplicate fails entirely, which would mean one already
 * notified person silently suppresses everyone else's reminder.
 *
 * So: read the keys that exist, insert only what is genuinely new, and if a
 * concurrent run still wins a race, fall back to inserting that chunk row by
 * row and skipping only the rows that actually collided.
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

const UNIQUE_VIOLATION = "23505";
const CHUNK = 200;

export async function createNotifications(
  db: SupabaseClient,
  drafts: NotificationDraft[],
): Promise<number> {
  if (drafts.length === 0) return 0;

  const keys = drafts.map((draft) => draft.dedupe_key);
  const seen = new Set<string>();

  for (let index = 0; index < keys.length; index += CHUNK) {
    const { data } = await db
      .from("notification")
      .select("user_id, dedupe_key")
      .in("dedupe_key", keys.slice(index, index + CHUNK));
    for (const row of (data ?? []) as { user_id: string; dedupe_key: string }[]) {
      seen.add(`${row.user_id}|${row.dedupe_key}`);
    }
  }

  const fresh = drafts.filter(
    (draft) => !seen.has(`${draft.user_id}|${draft.dedupe_key}`),
  );
  if (fresh.length === 0) return 0;

  let inserted = 0;

  for (let index = 0; index < fresh.length; index += CHUNK) {
    const chunk = fresh.slice(index, index + CHUNK);
    const { error } = await db.from("notification").insert(chunk);

    if (!error) {
      inserted += chunk.length;
      continue;
    }
    if (error.code !== UNIQUE_VIOLATION) {
      throw new Error(`could not create notifications: ${error.message}`);
    }

    // Lost a race with a concurrent run. Retry this chunk one row at a time so
    // the collision costs only the row that collided.
    for (const draft of chunk) {
      const { error: rowError } = await db.from("notification").insert(draft);
      if (!rowError) inserted += 1;
      else if (rowError.code !== UNIQUE_VIOLATION) {
        throw new Error(`could not create notification: ${rowError.message}`);
      }
    }
  }

  return inserted;
}
