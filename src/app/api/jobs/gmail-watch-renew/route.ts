import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { createGmailInboxWatch, gmailWatchNeedsRenewal, refreshGoogleAccessToken } from "@/features/inbox/services/gmail-sync";
import { recordJobRun } from "@/lib/job-observability";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return POST(request); }

/** Gmail watches expire within seven days; this daily worker renews 24h early. */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const topicName = process.env.GOOGLE_GMAIL_PUBSUB_TOPIC;
  if (!topicName || !process.env.GOOGLE_GMAIL_PUBSUB_AUDIENCE || !process.env.GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL) {
    return NextResponse.json({ error: "Gmail Pub/Sub topic, audience, or push service account is not configured." }, { status: 503 });
  }
  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }

  const { data: connections, error: connectionError } = await supabase.from("integration_connection")
    .select("id, organization_id")
    .eq("provider", "gmail")
    .eq("status", "connected");
  if (connectionError) return NextResponse.json({ error: "Could not load Gmail connections." }, { status: 500 });

  let renewed = 0; let skipped = 0; let failed = 0;
  for (const connection of connections ?? []) {
    const startedAt = new Date().toISOString();
    try {
      const { data: secret, error: secretError } = await supabase.from("integration_secret")
        .select("access_token, refresh_token, token_expires_at, gmail_history_id, gmail_watch_expiration_at")
        .eq("connection_id", connection.id)
        .maybeSingle();
      if (secretError) throw new Error(`Could not load OAuth token: ${secretError.message}`);
      if (!secret?.access_token) throw new Error("Missing token for Gmail integration.");
      if (!gmailWatchNeedsRenewal(secret.gmail_watch_expiration_at as string | null)) { skipped += 1; continue; }

      let accessToken = secret.access_token as string;
      const expiry = secret.token_expires_at ? new Date(secret.token_expires_at as string).getTime() : 0;
      if (expiry && expiry < Date.now() + 60_000) {
        if (!secret.refresh_token) throw new Error("Google access token expired and no refresh token is available.");
        const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
        if (!refreshed?.access_token) throw new Error("Google access token expired and could not be refreshed.");
        accessToken = refreshed.access_token;
        const { error } = await supabase.from("integration_secret").update({
          access_token: accessToken,
          token_expires_at: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
            : null,
        }).eq("connection_id", connection.id);
        if (error) throw new Error(`Could not save refreshed OAuth token: ${error.message}`);
      }

      const watch = await createGmailInboxWatch(accessToken, topicName);
      const { error } = await supabase.from("integration_secret").update({
        // Keep an existing cursor so renewal cannot skip unprocessed changes.
        gmail_history_id: secret.gmail_history_id ?? watch.historyId,
        gmail_watch_expiration_at: watch.expirationAt,
      }).eq("connection_id", connection.id);
      if (error) throw new Error(`Could not save Gmail watch state: ${error.message}`);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "gmail_watch_renew",
        status: "succeeded",
        details: { connectionId: connection.id },
        startedAt,
      });
      renewed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail watch renewal failed.";
      console.error("Gmail watch renewal failed", { connectionId: connection.id, error: message });
      await supabase.from("integration_connection")
        .update({ status: classifyIntegrationFailure(message), last_error: message })
        .eq("id", connection.id);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "gmail_watch_renew",
        status: "failed",
        details: { connectionId: connection.id }, error: message, startedAt,
      });
      failed += 1;
    }
  }
  return NextResponse.json({ ok: true, renewed, skipped, failed });
}
