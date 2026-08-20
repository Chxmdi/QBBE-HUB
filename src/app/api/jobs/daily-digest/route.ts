import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { localMailpitEnabled, sendProductionEmail } from "@/lib/email-provider";
import { sendSmtpMail } from "@/lib/smtp";
import { recordJobRun } from "@/lib/job-observability";

export const dynamic = "force-dynamic";

/** Daily non-urgent summary. Each included notification receives its own
 * `email_digest` delivery row, keeping a digest idempotent and auditable. */
export async function GET(request: Request) { return POST(request); }

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }

  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: preferences } = await supabase.from("notification_preference")
    .select("user_id").eq("email_digest", true);
  const userIds = (preferences ?? []).map((p) => p.user_id as string);
  if (!userIds.length) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });

  const [{ data: notifications }, { data: profiles }] = await Promise.all([
    supabase.from("notification").select("id, user_id, organization_id, title, body, created_at")
      .in("user_id", userIds).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    supabase.from("user_profile").select("id, email, full_name").in("id", userIds),
  ]);
  const items = (notifications ?? []) as { id: string; user_id: string; organization_id: string; title: string; body: string | null; created_at: string }[];
  if (!items.length) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  const { data: prior } = await supabase.from("notification_delivery").select("notification_id")
    .eq("channel", "email_digest").in("notification_id", items.map((item) => item.id));
  const priorIds = new Set((prior ?? []).map((row) => row.notification_id as string));
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p as { email: string; full_name: string }]));
  // A user may belong to multiple organizations. Never combine their
  // notifications across those tenancy boundaries in a single digest.
  const byRecipient = new Map<string, typeof items>();
  for (const item of items) {
    if (priorIds.has(item.id)) continue;
    const key = `${item.organization_id}:${item.user_id}`;
    const current = byRecipient.get(key) ?? [];
    current.push(item); byRecipient.set(key, current);
  }

  const mailpit = localMailpitEnabled();
  const from = process.env.EMAIL_FROM_ADDRESS || "hub@localhost";
  let sent = 0; let skipped = 0; let failed = 0;
  for (const [, rows] of byRecipient) {
    const { user_id: userId, organization_id: organizationId } = rows[0];
    const startedAt = new Date().toISOString();
    const profile = profileById.get(userId);
    if (!profile?.email) {
      skipped += rows.length;
      await recordJobRun(supabase, {
        organizationId, jobName: "daily_digest", status: "failed",
        details: { notifications: rows.length, reason: "recipient_missing" },
        error: "No recipient email on profile.", startedAt,
      });
      continue;
    }
    const text = [`Hello ${profile.full_name},`, "", "Your QBBE Hub daily digest:", "", ...rows.map((row) => `• ${row.title}${row.body ? ` — ${row.body}` : ""}`)].join("\n");
    try {
      if (mailpit) await sendSmtpMail({ host: process.env.SMTP_HOST ?? "127.0.0.1", port: Number(process.env.SMTP_PORT ?? "54325"), from, to: profile.email, subject: `[QBBE Hub] Daily digest (${rows.length})`, text });
      else await sendProductionEmail({
        to: profile.email,
        subject: `[QBBE Hub] Daily digest (${rows.length})`,
        text,
        idempotencyKey: `daily-digest:${organizationId}:${userId}:${new Date().toISOString().slice(0, 10)}`,
      });
      const { error } = await supabase.from("notification_delivery").upsert(rows.map((row) => ({
        notification_id: row.id, channel: "email_digest", status: "sent", attempts: 1,
        sent_at: new Date().toISOString(), dedupe_key: `email_digest:${row.id}`,
      })), { onConflict: "notification_id,channel" });
      if (error) throw error;
      sent += 1;
      await recordJobRun(supabase, {
        organizationId, jobName: "daily_digest", status: "succeeded",
        details: { notifications: rows.length }, startedAt,
      });
    } catch (error) {
      failed += rows.length;
      await recordJobRun(supabase, {
        organizationId, jobName: "daily_digest", status: "failed",
        details: { notifications: rows.length },
        error: error instanceof Error ? error.message : "Digest delivery failed.",
        startedAt,
      });
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, failed, useMailpit: mailpit });
}
