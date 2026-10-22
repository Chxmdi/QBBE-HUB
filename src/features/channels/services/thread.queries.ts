import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Messages a link names but the timeline has not loaded.
 *
 * A channel opens on its newest 100 messages, replies included. A
 * notification or search link to an older thread or message pointed at a row
 * the page did not have, so no thread opened and nothing was highlighted.
 * These read the named message, or a thread's root and every reply, on
 * demand; row-level security decides, as for the timeline.
 */

/** The most replies one thread panel loads. */
export const THREAD_REPLY_LIMIT = 500;

export interface MessageContainer {
  column: "channel_id" | "conversation_id";
  id: string;
}

type Row = { id: string; thread_root_id: string | null };

/** A thread's root and its replies, oldest first. Empty when the root is not readable here. */
export async function fetchThread<T extends Row>(
  db: SupabaseClient,
  container: MessageContainer,
  rootId: string,
  select: string,
): Promise<T[]> {
  const [root, replies] = await Promise.all([
    db.from("message").select(select).eq(container.column, container.id).eq("id", rootId).maybeSingle(),
    db
      .from("message")
      .select(select)
      .eq(container.column, container.id)
      .eq("thread_root_id", rootId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(THREAD_REPLY_LIMIT),
  ]);
  if (root.error || !root.data) return [];
  return [root.data as unknown as T, ...((replies.data ?? []) as unknown as T[])];
}

/**
 * One message, and when it is a reply, its thread: the link then opens the
 * thread it belongs to. Empty when the message is not readable here.
 */
export async function fetchLinkedMessage<T extends Row>(
  db: SupabaseClient,
  container: MessageContainer,
  messageId: string,
  select: string,
): Promise<T[]> {
  const { data, error } = await db
    .from("message")
    .select(select)
    .eq(container.column, container.id)
    .eq("id", messageId)
    .maybeSingle();
  if (error || !data) return [];
  const message = data as unknown as T;
  if (!message.thread_root_id) return [message];
  const thread = await fetchThread<T>(db, container, message.thread_root_id, select);
  return thread.some((m) => m.id === message.id) ? thread : [...thread, message];
}
