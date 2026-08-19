import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideDelivery,
  withPreferenceDefaults,
  type DeliveryPreferences,
  type NotificationUrgency,
} from "@/features/notifications/services/delivery-rules";
import {
  EmailSendError,
  sendEmail,
} from "@/features/notifications/services/email-provider";
import {
  renderNotificationEmail,
  type EmailBody,
} from "@/features/notifications/services/email-templates";
import { ack, deadLetter, enqueue, readBatch } from "../queue";
import type { JobContext, JobResult } from "../runner";

/**
 * Drains the notifications queue.
 *
 * Delivery is exactly-once by construction. Every message resolves to a
 * `dedupe_key`, and `email_delivery` carries a unique index on it. The first
 * thing this handler does is claim that key; a re-delivered message therefore
 * finds the existing row and continues it rather than sending a second copy.
 *
 * Nothing is acknowledged before the outcome is written. A worker killed
 * mid-send leaves its message on the queue with the ledger row still marked
 * `sending`; the visibility timeout re-delivers it, the claim recognises the
 * in-flight row, and the attempt continues from where it stopped.
 */

interface NotificationPayload {
  kind?: string;
  notification_id?: string;
  delivery_id?: string;
  dedupe_key?: string;
  deferred?: boolean;
}

interface DeliveryRow {
  id: string;
  status: string;
  attempt: number;
  recipient: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
}

const TERMINAL_STATUSES = new Set(["sent", "bounced", "suppressed"]);
const UNIQUE_VIOLATION = "23505";

/** Reads the row that already owns a dedupe key. */
async function existingDelivery(
  db: SupabaseClient,
  dedupeKey: string,
): Promise<DeliveryRow | null> {
  const { data } = await db
    .from("email_delivery")
    .select("id, status, attempt, recipient, subject, body_text, body_html")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  return (data as DeliveryRow | null) ?? null;
}

async function loadOrganizationName(
  db: SupabaseClient,
  cache: Map<string, string>,
  organizationId: string,
): Promise<string> {
  const cached = cache.get(organizationId);
  if (cached) return cached;
  const { data } = await db
    .from("organization")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();
  const name = (data?.name as string | undefined) ?? "QBBE";
  cache.set(organizationId, name);
  return name;
}

type Prepared =
  | { outcome: "ready"; delivery: DeliveryRow; email: EmailBody }
  | { outcome: "done" }
  | { outcome: "deferred"; delaySeconds: number };

/**
 * Turns a queued notification into a claimed, rendered delivery — or decides
 * that it should be suppressed or held.
 */
async function prepareNotification(
  db: SupabaseClient,
  notificationId: string,
  now: Date,
  orgNames: Map<string, string>,
): Promise<Prepared> {
  const { data: notificationRow } = await db
    .from("notification")
    .select(
      "id, user_id, organization_id, category, title, body, link, urgency, dedupe_key",
    )
    .eq("id", notificationId)
    .maybeSingle();

  // The notification was deleted between enqueue and drain. Nothing to send.
  if (!notificationRow) return { outcome: "done" };

  const notification = notificationRow as unknown as {
    id: string;
    user_id: string;
    organization_id: string;
    category: string;
    title: string;
    body: string | null;
    link: string | null;
    urgency: NotificationUrgency;
    dedupe_key: string | null;
  };

  const dedupeKey = notification.dedupe_key
    ? `email:${notification.dedupe_key}`
    : `email:notification:${notification.id}`;

  const existing = await existingDelivery(db, dedupeKey);
  if (existing && TERMINAL_STATUSES.has(existing.status)) return { outcome: "done" };

  const [{ data: profileRow }, { data: prefRow }] = await Promise.all([
    db
      .from("user_profile")
      .select("full_name, email")
      .eq("id", notification.user_id)
      .maybeSingle(),
    db
      .from("notification_preference")
      .select(
        "email_critical, email_digest, email_assignments, email_mentions, email_announcements, email_due_dates, quiet_hours_start, quiet_hours_end, digest_hour, timezone",
      )
      .eq("user_id", notification.user_id)
      .maybeSingle(),
  ]);

  const recipientName = (profileRow?.full_name as string | undefined) || "there";
  const recipientEmail = (profileRow?.email as string | undefined) ?? null;
  const prefs = withPreferenceDefaults(prefRow as Partial<DeliveryPreferences> | null);

  const decision = decideDelivery(
    { category: notification.category, urgency: notification.urgency },
    prefs,
    now,
    recipientEmail,
  );

  if (decision.action === "suppress") {
    await recordSuppression(db, {
      dedupeKey,
      existingId: existing?.id ?? null,
      organizationId: notification.organization_id,
      notificationId: notification.id,
      recipientUserId: notification.user_id,
      recipient: recipientEmail ?? "unknown",
      subject: notification.title,
      category: notification.category,
      reason: decision.reason,
    });
    return { outcome: "done" };
  }

  const organizationName = await loadOrganizationName(
    db,
    orgNames,
    notification.organization_id,
  );

  const email = renderNotificationEmail({
    title: notification.title,
    body: notification.body,
    category: notification.category,
    link: notification.link,
    recipientName,
    organizationName,
  });

  if (decision.action === "defer") {
    // Held, not dropped: the ledger row records the hold so an administrator
    // can see mail waiting on someone's quiet hours.
    const scheduledFor = new Date(now.getTime() + decision.delaySeconds * 1000);
    const held = await upsertDelivery(db, {
      dedupeKey,
      existingId: existing?.id ?? null,
      organizationId: notification.organization_id,
      notificationId: notification.id,
      recipientUserId: notification.user_id,
      recipient: recipientEmail!,
      category: notification.category,
      email,
      status: "queued",
      scheduledFor: scheduledFor.toISOString(),
      lastError: null,
      attempt: existing?.attempt ?? 0,
    });
    if (!held) return { outcome: "done" };
    return { outcome: "deferred", delaySeconds: decision.delaySeconds };
  }

  const attempt = (existing?.attempt ?? 0) + 1;
  const claimed = await upsertDelivery(db, {
    dedupeKey,
    existingId: existing?.id ?? null,
    organizationId: notification.organization_id,
    notificationId: notification.id,
    recipientUserId: notification.user_id,
    recipient: recipientEmail!,
    category: notification.category,
    email,
    status: "sending",
    scheduledFor: null,
    lastError: null,
    attempt,
  });

  // Lost the race to a concurrent worker that already finished this key.
  if (!claimed) return { outcome: "done" };

  return {
    outcome: "ready",
    delivery: {
      id: claimed.id,
      status: "sending",
      attempt,
      recipient: recipientEmail!,
      subject: email.subject,
      body_text: email.text,
      body_html: email.html,
    },
    email,
  };
}

interface UpsertInput {
  dedupeKey: string;
  existingId: string | null;
  organizationId: string;
  notificationId: string | null;
  recipientUserId: string;
  recipient: string;
  category: string;
  email: EmailBody;
  status: string;
  scheduledFor: string | null;
  lastError: string | null;
  attempt: number;
}

/**
 * Claims a dedupe key. Returns null when another worker holds it in a terminal
 * state, which is the signal to stop rather than send again.
 */
async function upsertDelivery(
  db: SupabaseClient,
  input: UpsertInput,
): Promise<{ id: string } | null> {
  const payload = {
    organization_id: input.organizationId,
    notification_id: input.notificationId,
    recipient_user_id: input.recipientUserId,
    recipient: input.recipient,
    subject: input.email.subject,
    body_text: input.email.text,
    body_html: input.email.html,
    category: input.category,
    kind: "notification",
    status: input.status,
    dedupe_key: input.dedupeKey,
    scheduled_for: input.scheduledFor,
    last_error: input.lastError,
    attempt: input.attempt,
  };

  if (input.existingId) {
    const { data } = await db
      .from("email_delivery")
      .update(payload)
      .eq("id", input.existingId)
      .not("status", "in", "(sent,bounced,suppressed)")
      .select("id")
      .maybeSingle();
    return (data as { id: string } | null) ?? null;
  }

  const { data, error } = await db
    .from("email_delivery")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Another worker inserted this key first. Re-read and continue only if
      // it has not reached a terminal state.
      const row = await existingDelivery(db, input.dedupeKey);
      if (!row || TERMINAL_STATUSES.has(row.status)) return null;
      return { id: row.id };
    }
    throw new Error(`could not record delivery: ${error.message}`);
  }

  return data as { id: string };
}

async function recordSuppression(
  db: SupabaseClient,
  input: {
    dedupeKey: string;
    existingId: string | null;
    organizationId: string;
    notificationId: string;
    recipientUserId: string;
    recipient: string;
    subject: string;
    category: string;
    reason: string;
  },
): Promise<void> {
  const payload = {
    organization_id: input.organizationId,
    notification_id: input.notificationId,
    recipient_user_id: input.recipientUserId,
    recipient: input.recipient,
    subject: input.subject,
    category: input.category,
    kind: "notification",
    status: "suppressed",
    suppressed_reason: input.reason,
    dedupe_key: input.dedupeKey,
  };

  if (input.existingId) {
    await db.from("email_delivery").update(payload).eq("id", input.existingId);
    return;
  }
  const { error } = await db.from("email_delivery").insert(payload);
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`could not record suppression: ${error.message}`);
  }
}

/** Loads a pre-built delivery row (the digest path enqueues these directly). */
async function prepareExistingDelivery(
  db: SupabaseClient,
  deliveryId: string,
): Promise<Prepared> {
  const { data } = await db
    .from("email_delivery")
    .select("id, status, attempt, recipient, subject, body_text, body_html")
    .eq("id", deliveryId)
    .maybeSingle();

  const row = data as DeliveryRow | null;
  if (!row || TERMINAL_STATUSES.has(row.status)) return { outcome: "done" };

  const attempt = row.attempt + 1;
  await db
    .from("email_delivery")
    .update({ status: "sending", attempt })
    .eq("id", row.id);

  return {
    outcome: "ready",
    delivery: { ...row, attempt, status: "sending" },
    email: {
      subject: row.subject,
      text: row.body_text ?? "",
      html: row.body_html ?? "",
    },
  };
}

export async function drainNotifications({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const messages = await readBatch<NotificationPayload>(db, "notifications", {
    visibilitySeconds: 120,
    quantity: definition.batch_size,
  });

  const orgNames = new Map<string, string>();
  let processed = 0;
  let failed = 0;
  let resolved = 0; // suppressed by preference, or already delivered
  let deferred = 0;

  for (const message of messages) {
    const payload = message.message ?? {};
    let prepared: Prepared;

    try {
      if (payload.delivery_id) {
        prepared = await prepareExistingDelivery(db, payload.delivery_id);
      } else if (payload.notification_id) {
        prepared = await prepareNotification(db, payload.notification_id, now, orgNames);
      } else {
        // Unroutable payload — archive rather than loop on it forever.
        await deadLetter(db, "notifications", message.msgId);
        failed += 1;
        continue;
      }
    } catch (cause) {
      // Preparation failed (database hiccup). Leave the message alone; the
      // visibility timeout re-delivers it.
      failed += 1;
      console.error(
        JSON.stringify({
          event: "job.notification.prepare_failed",
          msgId: message.msgId,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      continue;
    }

    if (prepared.outcome === "done") {
      await ack(db, "notifications", message.msgId);
      resolved += 1;
      continue;
    }

    if (prepared.outcome === "deferred") {
      await enqueue(db, "notifications", { ...payload, deferred: true }, prepared.delaySeconds);
      await ack(db, "notifications", message.msgId);
      deferred += 1;
      continue;
    }

    const { delivery, email } = prepared;

    try {
      const sent = await sendEmail({
        to: delivery.recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      await db
        .from("email_delivery")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider: sent.provider,
          provider_message_id: sent.providerMessageId,
          last_error: null,
        })
        .eq("id", delivery.id);

      await ack(db, "notifications", message.msgId);
      processed += 1;
    } catch (cause) {
      failed += 1;
      const retryable = cause instanceof EmailSendError ? cause.retryable : true;
      const detail = cause instanceof Error ? cause.message : String(cause);
      const exhausted = delivery.attempt >= definition.max_attempts;

      await db
        .from("email_delivery")
        .update({
          status: !retryable ? "bounced" : exhausted ? "failed" : "queued",
          last_error: detail.slice(0, 1000),
        })
        .eq("id", delivery.id);

      if (!retryable || exhausted) {
        // Permanent, or out of attempts: move it to the archive so it shows up
        // as a dead letter instead of cycling forever.
        await deadLetter(db, "notifications", message.msgId);
      }
      // Otherwise leave it on the queue — the visibility timeout is the retry.
    }
  }

  return {
    processed,
    failed,
    metadata: { read: messages.length, resolved, deferred },
  };
}
