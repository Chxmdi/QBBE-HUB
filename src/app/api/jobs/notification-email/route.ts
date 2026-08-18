import { NextResponse } from "next/server";
import {
  deliveryCanRetry,
  deliveryDedupeKey,
  nextDeliveryAttempt,
  shouldQueueEmail,
  type Notifiable,
} from "@/features/inbox/services/email-delivery";
import { sendSmtpMail } from "@/lib/smtp";
import { localMailpitEnabled, sendProductionEmail } from "@/lib/email-provider";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordJobRun } from "@/lib/job-observability";

export const dynamic = "force-dynamic";

const CRITICAL = ["assignment", "mention", "announcement", "due_date"];

/**
 * Cron: queue + send critical notification email.
 * Auth: `Authorization: Bearer $CRON_JOB_SECRET`.
 * Local: Mailpit SMTP (default 127.0.0.1:54325). Production: set
 * EMAIL_PROVIDER_API_KEY — until then the job records an honest skip.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Service role is not configured; email job cannot run." },
      { status: 503 },
    );
  }

  const { data: notifications } = await supabase
    .from("notification")
    .select("id, user_id, organization_id, category, title, body, urgency, created_at")
    .in("category", CRITICAL)
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(200);

  const rows = (notifications ?? []) as (Notifiable & { user_id: string; organization_id: string })[];
  const { data: existing } = await supabase
    .from("notification_delivery")
    .select("id, dedupe_key, status, attempts, next_attempt_at")
    .in(
      "dedupe_key",
      rows.map((n) => deliveryDedupeKey(n.id)),
    );
  const deliveryByKey = new Map(
    (existing ?? []).map((row) => [row.dedupe_key as string, row as {
      id: string; status: string; attempts: number; next_attempt_at: string | null;
    }]),
  );

  const userIds = [...new Set(rows.map((n) => n.user_id))];
  const [{ data: prefs }, { data: profiles }] = await Promise.all([
    supabase.from("notification_preference").select("user_id, email_critical").in("user_id", userIds),
    supabase.from("user_profile").select("id, email, full_name").in("id", userIds),
  ]);
  const prefByUser = new Map(
    (prefs ?? []).map((p) => [p.user_id as string, { email_critical: Boolean(p.email_critical) }]),
  );
  const profileByUser = new Map(
    (profiles ?? []).map((p) => [p.id as string, p as { email: string; full_name: string }]),
  );

  const smtpHost = process.env.SMTP_HOST ?? "127.0.0.1";
  const smtpPort = Number(process.env.SMTP_PORT ?? "54325");
  const from = process.env.EMAIL_FROM_ADDRESS || "hub@localhost";
  const mailpit = localMailpitEnabled();

  let queued = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const organizationIds = new Set(rows.map((row) => row.organization_id));
  const startedAt = new Date().toISOString();

  for (const notification of rows) {
    const pref = prefByUser.get(notification.user_id) ?? null;
    if (!shouldQueueEmail(notification, pref)) {
      skipped += 1;
      continue;
    }
    const profile = profileByUser.get(notification.user_id);
    const dedupe = deliveryDedupeKey(notification.id);
    const existingDelivery = deliveryByKey.get(dedupe);
    let attempt = 1;
    if (existingDelivery) {
      if (existingDelivery.status === "sent" || !deliveryCanRetry(existingDelivery)) {
        skipped += 1;
        continue;
      }
      attempt = existingDelivery.attempts + 1;
      const claim = await supabase.from("notification_delivery")
        .update({ status: "pending", attempts: attempt, next_attempt_at: null, last_error: null })
        .eq("id", existingDelivery.id)
        .eq("status", "failed")
        .select("id");
      if (claim.error || !claim.data?.length) {
        skipped += 1;
        continue;
      }
    } else {
      const insert = await supabase.from("notification_delivery").insert({
        notification_id: notification.id,
        channel: "email",
        status: "pending",
        attempts: attempt,
        dedupe_key: dedupe,
      });
      if (insert.error) {
        // Unique violation = another worker already queued this row.
        skipped += 1;
        continue;
      }
      queued += 1;
    }

    if (!profile?.email) {
      await supabase
        .from("notification_delivery")
        .update({ status: "failed", attempts: 5, next_attempt_at: null, last_error: "No recipient email on profile." })
        .eq("dedupe_key", dedupe);
      failed += 1;
      continue;
    }

    try {
      let providerMessageId: string | null = null;
      if (mailpit) {
        await sendSmtpMail({
          host: smtpHost,
          port: smtpPort,
          from,
          to: profile.email,
          subject: `[QBBE Hub] ${notification.title}`,
          text: notification.body ?? notification.title,
        });
      } else {
        providerMessageId = await sendProductionEmail({
          to: profile.email,
          subject: `[QBBE Hub] ${notification.title}`,
          text: notification.body ?? notification.title,
          idempotencyKey: dedupe,
        });
      }
      const { error: deliveryUpdateError } = await supabase
        .from("notification_delivery")
        .update({ status: "sent", sent_at: new Date().toISOString(), next_attempt_at: null, provider_message_id: providerMessageId, last_error: null })
        .eq("dedupe_key", dedupe);
      if (deliveryUpdateError) throw new Error(`Could not record sent notification email: ${deliveryUpdateError.message}`);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      await supabase
        .from("notification_delivery")
        .update({ status: "failed", next_attempt_at: nextDeliveryAttempt(attempt), last_error: message })
        .eq("dedupe_key", dedupe);
      failed += 1;
    }
  }

  for (const organizationId of organizationIds) {
    await recordJobRun(supabase, {
      organizationId,
      jobName: "notification_email",
      status: failed > 0 ? "failed" : "succeeded",
      details: { queued, sent, skipped, failed },
      error: failed > 0 ? "One or more notification emails could not be delivered." : null,
      startedAt,
    });
  }

  return NextResponse.json({ ok: true, queued, sent, skipped, failed, useMailpit: mailpit });
}
