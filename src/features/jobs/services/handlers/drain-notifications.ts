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
import { PartialJobFailure, type JobContext, type JobResult } from "../runner";

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
 *
 * A batch is not all-or-nothing. One message's failure is confined to that
 * message: the rest of the batch still runs and the failed one returns on the
 * next tick. Two things end that patience — a message read more times than the
 * job's attempt limit is archived rather than left to occupy a slot in every
 * future batch, and a failure of the queue calls themselves stops the run,
 * because that is the queue being gone rather than one bad message.
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

/**
 * What to do with a message once its outcome is known.
 *
 * Deciding this separately from doing it is what keeps one message's trouble
 * from becoming the batch's. Everything that can fail on the message's own
 * account happens while the disposition is being worked out and is caught
 * there; only the queue calls that carry it out are left outside, and those
 * failing means the queue itself is gone, not this message.
 */
type Disposition =
  | { kind: "ack" }
  | { kind: "dead-letter" }
  | { kind: "defer"; delaySeconds: number }
  /** Left on the queue: the visibility timeout is the retry. */
  | { kind: "leave" };

interface Handled {
  disposition: Disposition;
  /** Which counter this message lands in. `resolved` is neither. */
  outcome: "processed" | "failed" | "resolved" | "deferred";
}

async function handleMessage(
  db: SupabaseClient,
  payload: NotificationPayload,
  definition: JobContext["definition"],
  now: Date,
  orgNames: Map<string, string>,
): Promise<Handled> {
  let prepared: Prepared;

  if (payload.delivery_id) {
    prepared = await prepareExistingDelivery(db, payload.delivery_id);
  } else if (payload.notification_id) {
    prepared = await prepareNotification(db, payload.notification_id, now, orgNames);
  } else {
    // Unroutable payload — archive rather than loop on it forever.
    return { disposition: { kind: "dead-letter" }, outcome: "failed" };
  }

  if (prepared.outcome === "done") {
    return { disposition: { kind: "ack" }, outcome: "resolved" };
  }
  if (prepared.outcome === "deferred") {
    return {
      disposition: { kind: "defer", delaySeconds: prepared.delaySeconds },
      outcome: "deferred",
    };
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

    return { disposition: { kind: "ack" }, outcome: "processed" };
  } catch (cause) {
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

    return {
      // Permanent, or out of attempts: archive it so it shows up as a dead
      // letter instead of cycling forever.
      disposition: !retryable || exhausted ? { kind: "dead-letter" } : { kind: "leave" },
      outcome: "failed",
    };
  }
}

/**
 * How long the loop may keep starting sends.
 *
 * The visibility timeout is the only thing stopping two workers from holding
 * the same message, and it does that only if a batch cannot outlive it. A
 * batch of 25 sends against a slow provider can: the earliest messages become
 * visible again while this run is still working through the rest, and the next
 * tick sends them a second time. The claim on `email_delivery` does not save
 * us — it excludes rows in a *terminal* state, and a row another worker is
 * mid-send on is not terminal.
 *
 * So the batch stops starting work well inside both the visibility window and
 * the route's own 60-second ceiling, with room for one more bounded send. What
 * is left keeps its place on the queue and is picked up by the next tick.
 */
const VISIBILITY_SECONDS = 120;
const BATCH_BUDGET_MS = 40_000;

export async function drainNotifications({
  db,
  definition,
  now,
}: JobContext): Promise<JobResult> {
  const messages = await readBatch<NotificationPayload>(db, "notifications", {
    visibilitySeconds: VISIBILITY_SECONDS,
    quantity: definition.batch_size,
  });

  const orgNames = new Map<string, string>();
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let resolved = 0; // suppressed by preference, or already delivered
  let deferred = 0;
  let poisoned = 0;
  let unstarted = 0;

  const summary = (): JobResult => ({
    processed,
    failed,
    metadata: { read: messages.length, resolved, deferred, poisoned, unstarted },
  });

  for (const [index, message] of messages.entries()) {
    if (Date.now() - startedAt >= BATCH_BUDGET_MS) {
      unstarted = messages.length - index;
      break;
    }

    const payload = message.message ?? {};
    let handled: Handled;

    // A message delivered more often than the job's attempt limit is not going
    // to start succeeding, and it occupies a slot in every batch until it is
    // taken out — enough of them and real work never gets read at all. The
    // per-delivery attempt counter cannot see this case, because a message
    // that fails before it has a delivery row never increments one.
    if (message.readCount > definition.max_attempts) {
      handled = { disposition: { kind: "dead-letter" }, outcome: "failed" };
      poisoned += 1;
      console.error(
        JSON.stringify({
          event: "job.notification.poisoned",
          msgId: message.msgId,
          readCount: message.readCount,
        }),
      );
    } else {
      try {
        handled = await handleMessage(db, payload, definition, now, orgNames);
      } catch (cause) {
        // One message's failure is its own. The rest of the batch still runs,
        // and this one comes back when the visibility timeout lapses.
        failed += 1;
        console.error(
          JSON.stringify({
            event: "job.notification.failed",
            msgId: message.msgId,
            readCount: message.readCount,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
        continue;
      }
    }

    switch (handled.outcome) {
      case "processed":
        processed += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "resolved":
        resolved += 1;
        break;
      case "deferred":
        deferred += 1;
        break;
    }

    try {
      switch (handled.disposition.kind) {
        case "ack":
          await ack(db, "notifications", message.msgId);
          break;
        case "dead-letter":
          await deadLetter(db, "notifications", message.msgId);
          break;
        case "defer":
          await enqueue(
            db,
            "notifications",
            { ...payload, deferred: true },
            handled.disposition.delaySeconds,
          );
          await ack(db, "notifications", message.msgId);
          break;
        case "leave":
          break;
      }
    } catch (cause) {
      // The queue itself is unreachable, so every remaining message would fail
      // the same way. Stop, and report what this run had already done rather
      // than letting it be recorded as a run that achieved nothing.
      throw new PartialJobFailure(
        cause instanceof Error ? cause.message : String(cause),
        summary(),
      );
    }
  }

  return summary();
}
