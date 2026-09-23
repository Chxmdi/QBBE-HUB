import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One write path for notifications.
 *
 * The dedupe key names the event, not the reason someone was included. Mention,
 * assignment, and follow on that same event collapse to one row, and the
 * reasons are merged into it. A second email is then impossible: the unique
 * key on (user_id, dedupe_key) is what the mailer also keys off.
 *
 * Rows without a dedupe key are refused here. PostgreSQL treats NULLs as
 * distinct, so a missing key would never collapse.
 */

export type NotificationUrgency = "low" | "normal" | "high" | "critical";

export interface NotificationDraft {
  user_id: string;
  organization_id: string;
  category: string;
  title: string;
  body?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  link?: string | null;
  urgency?: NotificationUrgency;
  dedupe_key: string;
  reason?: string | null;
  context?: string | null;
  owner_label?: string | null;
  due_on?: string | null;
  project_id?: string | null;
  thread_id?: string | null;
}

const CHUNK = 200;

const URGENCY_RANK: Record<NotificationUrgency, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

/** `source_type:source_id:user_id`, optionally with one event token between. */
export function notificationDedupeKey(
  sourceType: string,
  sourceId: string,
  userId: string,
  event?: string,
): string {
  return event
    ? `${sourceType}:${sourceId}:${event}:${userId}`
    : `${sourceType}:${sourceId}:${userId}`;
}

/** Comma-separated reasons, without duplicates, in first-seen order. */
export function mergeReasons(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const value of [existing, incoming]) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      parts.push(trimmed);
    }
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function higherUrgency(
  left: NotificationUrgency | undefined,
  right: NotificationUrgency | undefined,
): NotificationUrgency {
  const a = left ?? "normal";
  const b = right ?? "normal";
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

/**
 * Collapses drafts that name the same person and the same event. The surviving
 * draft keeps every reason and the more urgent of the two.
 */
export function collapseDrafts(drafts: NotificationDraft[]): NotificationDraft[] {
  const byKey = new Map<string, NotificationDraft>();
  for (const draft of drafts) {
    if (!draft.dedupe_key) continue;
    const key = `${draft.user_id}\u0000${draft.dedupe_key}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, { ...draft, reason: mergeReasons(null, draft.reason) });
      continue;
    }
    prior.reason = mergeReasons(prior.reason, draft.reason);
    prior.urgency = higherUrgency(prior.urgency, draft.urgency);
    prior.context = prior.context ?? draft.context ?? null;
    prior.owner_label = prior.owner_label ?? draft.owner_label ?? null;
    prior.due_on = prior.due_on ?? draft.due_on ?? null;
    prior.project_id = prior.project_id ?? draft.project_id ?? null;
    prior.thread_id = prior.thread_id ?? draft.thread_id ?? null;
    prior.link = prior.link ?? draft.link ?? null;
    prior.body = prior.body ?? draft.body ?? null;
  }
  return [...byKey.values()];
}

function rowPayload(draft: NotificationDraft): Record<string, unknown> {
  return {
    user_id: draft.user_id,
    organization_id: draft.organization_id,
    category: draft.category,
    title: draft.title,
    body: draft.body ?? null,
    source_type: draft.source_type ?? null,
    source_id: draft.source_id ?? null,
    link: draft.link ?? null,
    urgency: draft.urgency ?? "normal",
    dedupe_key: draft.dedupe_key,
    reason: draft.reason ?? null,
    context: draft.context ?? null,
    owner_label: draft.owner_label ?? null,
    due_on: draft.due_on ?? null,
    project_id: draft.project_id ?? null,
    thread_id: draft.thread_id ?? null,
  };
}

/**
 * Inserts notifications, merging reasons when the event already exists for
 * that person. Returns how many new rows were created. A merge is not a
 * second notification.
 */
export async function createNotifications(
  db: SupabaseClient,
  drafts: NotificationDraft[],
): Promise<number> {
  const collapsed = collapseDrafts(drafts);
  let inserted = 0;

  for (let index = 0; index < collapsed.length; index += CHUNK) {
    const chunk = collapsed.slice(index, index + CHUNK);
    const userIds = [...new Set(chunk.map((draft) => draft.user_id))];
    const keys = [...new Set(chunk.map((draft) => draft.dedupe_key))];

    const { data: existingRows, error: existingError } = await db
      .from("notification")
      .select("id, user_id, dedupe_key, reason")
      .in("user_id", userIds)
      .in("dedupe_key", keys);

    if (existingError) {
      throw new Error(`could not load notifications: ${existingError.message}`);
    }

    const existing = new Map<string, { id: string; reason: string | null }>();
    for (const row of existingRows ?? []) {
      existing.set(`${row.user_id as string}\u0000${row.dedupe_key as string}`, {
        id: row.id as string,
        reason: (row.reason as string | null) ?? null,
      });
    }

    const fresh: NotificationDraft[] = [];
    for (const draft of chunk) {
      const prior = existing.get(`${draft.user_id}\u0000${draft.dedupe_key}`);
      if (!prior) {
        fresh.push(draft);
        continue;
      }
      const reason = mergeReasons(prior.reason, draft.reason);
      const { error } = await db
        .from("notification")
        .update({
          reason,
          title: draft.title,
          body: draft.body ?? null,
          context: draft.context ?? null,
          owner_label: draft.owner_label ?? null,
          due_on: draft.due_on ?? null,
          link: draft.link ?? null,
          category: draft.category,
          urgency: draft.urgency ?? "normal",
          read_at: null,
        })
        .eq("id", prior.id);
      if (error) throw new Error(`could not merge notification: ${error.message}`);
    }

    if (fresh.length === 0) continue;

    const { data, error } = await db
      .from("notification")
      .upsert(fresh.map(rowPayload), {
        onConflict: "user_id,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) throw new Error(`could not create notifications: ${error.message}`);
    inserted += data?.length ?? 0;
  }

  return inserted;
}
