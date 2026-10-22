import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One write path for notifications.
 *
 * The dedupe key names the event, not the reason someone was included. Mention,
 * assignment, and follow on that same event collapse to one row, and the
 * reasons are merged into it, and the mailer keys off the same (user_id,
 * dedupe_key), so one event sends one email. When the event happens again the
 * row is re-opened rather than dropped, and a read one sends one more email.
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
export function collapseDrafts(
  drafts: NotificationDraft[],
): NotificationDraft[] {
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
 * Creates notifications, re-opening the person's existing one when the event
 * repeats (unread again, reasons merged). Returns how many new rows were
 * created; a re-opened notification is not a new one.
 *
 * The database does it (create_notifications). A person cannot read anyone
 * else's notifications, so reading first to merge saw nothing, and the
 * insert that followed hit the unique key: a second mention, a task back in
 * review or a reassignment back never reached the person. The function runs
 * as the caller, so their insert rule still decides what they may create.
 */
export async function createNotifications(
  db: SupabaseClient,
  drafts: NotificationDraft[],
): Promise<number> {
  const collapsed = collapseDrafts(drafts);
  let created = 0;
  for (let index = 0; index < collapsed.length; index += CHUNK) {
    const chunk = collapsed.slice(index, index + CHUNK);
    const { data, error } = await db.rpc("create_notifications", { p_rows: chunk.map(rowPayload) });
    if (error) throw new Error(`could not create notifications: ${error.message}`);
    created += Number(data ?? 0);
  }
  return created;
}
