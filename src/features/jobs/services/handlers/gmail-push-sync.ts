import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { reconcileGmailConnection } from "@/features/inbox/services/gmail-reconcile";
import { ack, deadLetter, readBatch } from "../queue";
import type { JobContext, JobResult } from "../runner";

interface GmailPushQueuePayload {
  kind?: string;
  connection_id?: string;
}

/**
 * Processes durable Gmail push work from the integrations queue.
 *
 * Pub/Sub delivery is at-least-once, so duplicate queue messages are expected.
 * The durable Gmail history cursor makes reconciliation idempotent: once one
 * message advances the cursor and clears the pending push marker, later
 * duplicates resolve without sending or storing anything twice.
 */
export async function gmailPushSync({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const messages = await readBatch<GmailPushQueuePayload>(db, "integrations", {
    visibilitySeconds: 120,
    quantity: definition.batch_size,
  });

  let processed = 0;
  let failed = 0;
  let resolved = 0;
  let deadLettered = 0;

  for (const message of messages) {
    const payload = message.message ?? {};
    if (payload.kind !== "gmail_push" || typeof payload.connection_id !== "string") {
      await deadLetter(db, "integrations", message.msgId);
      deadLettered += 1;
      failed += 1;
      continue;
    }

    const { data: connection, error: connectionError } = await db
      .from("integration_connection")
      .select("id, organization_id, user_id, provider, status")
      .eq("id", payload.connection_id)
      .maybeSingle();

    if (connectionError) {
      failed += 1;
      continue;
    }

    if (
      !connection ||
      connection.provider !== "gmail" ||
      connection.status !== "connected" ||
      !connection.user_id
    ) {
      await ack(db, "integrations", message.msgId);
      resolved += 1;
      continue;
    }

    const { data: secret, error: secretError } = await db
      .from("integration_secret")
      .select("gmail_pending_history_id")
      .eq("connection_id", connection.id)
      .maybeSingle();

    if (secretError) {
      failed += 1;
      continue;
    }

    // Another worker may already have processed this at-least-once delivery.
    if (!secret?.gmail_pending_history_id) {
      await ack(db, "integrations", message.msgId);
      resolved += 1;
      continue;
    }

    try {
      await reconcileGmailConnection(db, {
        id: connection.id,
        organization_id: connection.organization_id,
        user_id: connection.user_id,
      }, now);
      await ack(db, "integrations", message.msgId);
      processed += 1;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Gmail push synchronization failed.";
      await db
        .from("integration_connection")
        .update({
          status: classifyIntegrationFailure(detail),
          last_error: detail.slice(0, 1000),
        })
        .eq("id", connection.id);

      failed += 1;
      if (message.readCount >= definition.max_attempts) {
        await deadLetter(db, "integrations", message.msgId);
        deadLettered += 1;
      }
      // Otherwise the visibility timeout is the retry.
    }
  }

  return {
    processed,
    failed,
    metadata: {
      read: messages.length,
      resolved,
      deadLettered,
    },
  };
}
