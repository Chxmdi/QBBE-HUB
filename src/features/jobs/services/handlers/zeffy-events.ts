import { ZeffyClient, ZeffyRateLimitedError, zeffyConfig } from "@/features/zeffy/client";
import {
  eraseDeletedContact,
  markPaymentDeleted,
  saveContacts,
  savePayments,
  unlinkContact,
  type ZeffyContext,
} from "@/features/zeffy/sync";
import { zeffyContactSchema, zeffyPaymentSchema } from "@/features/zeffy/types";
import type { JobContext, JobResult } from "../runner";

/**
 * Applies the changes Zeffy reported by webhook. Most Zeffy events carry only
 * an id, so this reads the payment or contact as it is now and saves that:
 * whatever order the events arrive in, the Hub ends at Zeffy's current state.
 *
 * An event is tried up to 12 times, then closed with its error kept; the
 * 15-minute sync and its daily refresh catch anything that still slips.
 */

const MAX_ATTEMPTS = 12;
const KEEP_PROCESSED_DAYS = 30;

interface EventRow {
  event_id: string;
  organization_id: string | null;
  event_type: string;
  resource_id: string | null;
  attempts: number;
}

async function applyEvent(ctx: ZeffyContext, client: ZeffyClient, event: EventRow): Promise<void> {
  const id = event.resource_id;
  if (!id) return;

  switch (event.event_type) {
    case "payment.completed":
    case "payment.created":
    case "payment.updated": {
      const raw = await client.get("payments", id);
      if (raw === null) {
        await markPaymentDeleted(ctx, id);
        return;
      }
      const parsed = zeffyPaymentSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Unexpected Zeffy payment shape.");
      await savePayments(ctx, [parsed.data]);
      return;
    }
    case "payment.deleted":
      await markPaymentDeleted(ctx, id);
      return;
    case "contact.created":
    case "contact.updated": {
      const raw = await client.get("contacts", id);
      if (raw === null) {
        await unlinkContact(ctx, id);
        return;
      }
      const parsed = zeffyContactSchema.safeParse(raw);
      if (!parsed.success) throw new Error("Unexpected Zeffy contact shape.");
      await saveContacts(ctx, [parsed.data]);
      return;
    }
    case "contact.deleted":
      await eraseDeletedContact(ctx, id);
      return;
    default:
      return;
  }
}

export async function zeffyEvents({ db, now, definition }: JobContext): Promise<JobResult> {
  const cutoff = new Date(now.getTime() - KEEP_PROCESSED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: cleanupError } = await db
    .from("zeffy_webhook_event")
    .delete()
    .not("processed_at", "is", null)
    .lt("processed_at", cutoff);
  if (cleanupError) throw new Error(`could not clear old Zeffy events: ${cleanupError.message}`);

  const config = zeffyConfig();
  if (!config) {
    return { processed: 0, failed: 0, metadata: { skipped: "ZEFFY_API_KEY is not set" } };
  }

  const { data, error } = await db
    .from("zeffy_webhook_event")
    .select("event_id, organization_id, event_type, resource_id, attempts")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(definition.batch_size);
  if (error) throw new Error(`could not load Zeffy events: ${error.message}`);

  const client = new ZeffyClient(config);
  let processed = 0;
  let failed = 0;
  let rateLimited = false;

  for (const event of (data ?? []) as EventRow[]) {
    if (!event.organization_id) continue;
    try {
      await applyEvent({ db, organizationId: event.organization_id, now }, client, event);
      const { error: doneError } = await db
        .from("zeffy_webhook_event")
        .update({ processed_at: now.toISOString(), attempts: event.attempts + 1, last_error: null })
        .eq("event_id", event.event_id);
      if (doneError) throw new Error(`could not record a Zeffy event: ${doneError.message}`);
      processed += 1;
    } catch (cause) {
      if (cause instanceof ZeffyRateLimitedError) {
        // Leave this one and the rest for the next minute.
        rateLimited = true;
        break;
      }
      failed += 1;
      const message = cause instanceof Error ? cause.message : "Zeffy event failed.";
      const attempts = event.attempts + 1;
      // After the last attempt the event is closed with its error kept; the
      // scheduled sync still brings the payment or contact in.
      await db
        .from("zeffy_webhook_event")
        .update({
          attempts,
          last_error: message.slice(0, 1000),
          ...(attempts >= MAX_ATTEMPTS ? { processed_at: now.toISOString() } : {}),
        })
        .eq("event_id", event.event_id);
    }
  }

  return { processed, failed, metadata: { rateLimited, requests: client.requests } };
}
