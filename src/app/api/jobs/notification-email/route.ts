import { NextResponse } from "next/server";
import {
  alreadyDelivered,
  deliveryDedupeKey,
  shouldQueueEmail,
  type Notifiable,
} from "@/features/inbox/services/email-delivery";
import { sendSmtpMail } from "@/lib/smtp";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const CRITICAL = ["assignment", "mention", "announcement", "due_date"];

/**
 * Cron: queue + send critical notification email.
 * Auth: `Authorization: Bearer $CRON_JOB_SECRET`.
 * Local: Mailpit SMTP (default 127.0.0.1:54325). Production: set
 * EMAIL_PROVIDER_API_KEY — until then the job records an honest skip.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_JOB_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
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
    .select("id, user_id, category, title, body, urgency, created_at")
    .in("category", CRITICAL)
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .limit(200);

  const rows = (notifications ?? []) as (Notifiable & { user_id: string })[];
  const { data: existing } = await supabase
    .from("notification_delivery")
    .select("dedupe_key")
    .in(
      "dedupe_key",
      rows.map((n) => deliveryDedupeKey(n.id)),
    );
  const existingKeys = new Set(
    (existing ?? []).map((r) => r.dedupe_key as string),
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
  const providerConfigured = Boolean(process.env.EMAIL_PROVIDER_API_KEY);
  const useMailpit = !providerConfigured;

  let queued = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const notification of rows) {
    if (alreadyDelivered(existingKeys, notification.id)) {
      skipped += 1;
      continue;
    }
    const pref = prefByUser.get(notification.user_id) ?? null;
    if (!shouldQueueEmail(notification, pref)) {
      skipped += 1;
      continue;
    }
    const profile = profileByUser.get(notification.user_id);
    const dedupe = deliveryDedupeKey(notification.id);
    const insert = await supabase.from("notification_delivery").insert({
      notification_id: notification.id,
      channel: "email",
      status: "pending",
      attempts: 1,
      dedupe_key: dedupe,
    });
    if (insert.error) {
      // Unique violation = another worker already queued this row.
      skipped += 1;
      continue;
    }
    queued += 1;
    existingKeys.add(dedupe);

    if (!profile?.email) {
      await supabase
        .from("notification_delivery")
        .update({ status: "failed", last_error: "No recipient email on profile." })
        .eq("dedupe_key", dedupe);
      failed += 1;
      continue;
    }

    try {
      if (useMailpit) {
        await sendSmtpMail({
          host: smtpHost,
          port: smtpPort,
          from,
          to: profile.email,
          subject: `[QBBE Hub] ${notification.title}`,
          text: notification.body ?? notification.title,
        });
      } else {
        // Production provider hook: a real SendGrid/Resend call belongs here.
        // Until a provider client is wired, record an honest pending state.
        await supabase
          .from("notification_delivery")
          .update({
            status: "pending",
            last_error: "EMAIL_PROVIDER_API_KEY is set but no provider client is wired yet.",
          })
          .eq("dedupe_key", dedupe);
        continue;
      }
      await supabase
        .from("notification_delivery")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("dedupe_key", dedupe);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      await supabase
        .from("notification_delivery")
        .update({ status: "failed", last_error: message })
        .eq("dedupe_key", dedupe);
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, queued, sent, skipped, failed, useMailpit });
}
