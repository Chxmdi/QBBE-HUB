import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed access to the pgmq queues, through the service-role-only wrappers
 * created in migration 0008.
 *
 * The contract is at-least-once: `read` hides a message for `visibilitySeconds`
 * and increments its read count. Deleting is the acknowledgement. A worker that
 * dies before deleting loses nothing — the message reappears when the
 * visibility timeout lapses.
 */

export type QueueName = "notifications" | "integrations" | "exports";

export interface QueueMessage<T = Record<string, unknown>> {
  msgId: number;
  readCount: number;
  enqueuedAt: string;
  message: T;
}

interface RawQueueRow {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: Record<string, unknown>;
}

export async function enqueue(
  db: SupabaseClient,
  queue: QueueName,
  message: Record<string, unknown>,
  delaySeconds = 0,
): Promise<number> {
  const { data, error } = await db.rpc("job_queue_send", {
    p_queue: queue,
    p_message: message,
    p_delay_seconds: delaySeconds,
  });
  if (error) throw new Error(`could not enqueue on ${queue}: ${error.message}`);
  return data as number;
}

export async function readBatch<T = Record<string, unknown>>(
  db: SupabaseClient,
  queue: QueueName,
  { visibilitySeconds = 120, quantity = 25 } = {},
): Promise<QueueMessage<T>[]> {
  const { data, error } = await db.rpc("job_queue_read", {
    p_queue: queue,
    p_visibility_seconds: visibilitySeconds,
    p_quantity: quantity,
  });
  if (error) throw new Error(`could not read ${queue}: ${error.message}`);
  return ((data ?? []) as RawQueueRow[]).map((row) => ({
    msgId: row.msg_id,
    readCount: row.read_ct,
    enqueuedAt: row.enqueued_at,
    message: row.message as T,
  }));
}

/** Acknowledges a message. After this it is gone. */
export async function ack(
  db: SupabaseClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  const { error } = await db.rpc("job_queue_delete", {
    p_queue: queue,
    p_msg_id: msgId,
  });
  if (error) throw new Error(`could not ack ${queue}#${msgId}: ${error.message}`);
}

/** Moves a message to the archive — the dead-letter table. */
export async function deadLetter(
  db: SupabaseClient,
  queue: QueueName,
  msgId: number,
): Promise<void> {
  const { error } = await db.rpc("job_queue_archive", {
    p_queue: queue,
    p_msg_id: msgId,
  });
  if (error) {
    throw new Error(`could not dead-letter ${queue}#${msgId}: ${error.message}`);
  }
}

/**
 * Exponential backoff for a redelivered message, capped so a poisoned message
 * still reaches its attempt limit within an hour rather than lingering for days.
 */
export function backoffSeconds(readCount: number): number {
  return Math.min(900, 30 * 2 ** Math.max(0, readCount - 1));
}
