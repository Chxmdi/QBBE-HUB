import { after, NextResponse } from "next/server";
import { dbDetail, logEvent, logRefusal } from "@/lib/server-log";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { gmailPushClaimsAreValid, parseGmailPushNotification } from "@/features/inbox/services/gmail-sync";
import { enqueue } from "@/features/jobs/services/queue";
import { runJob } from "@/features/jobs/services/runner";

export const dynamic = "force-dynamic";

async function pubsubRequestAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length);
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;
  const claims = await response.json() as Record<string, unknown>;
  return gmailPushClaimsAreValid(
    claims,
    process.env.GOOGLE_GMAIL_PUBSUB_AUDIENCE,
    process.env.GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL,
  );
}

/** Receives an authenticated Pub/Sub push message. The OIDC issuer, intended
 * audience, service-account identity, and expiry are verified before parsing. */
export async function POST(request: Request) {
  if (!(await pubsubRequestAuthorized(request).catch(() => false))) {
    await logRefusal("gmail_push", "unauthorized", 401, request);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { message?: { data?: unknown } };
  try { body = await request.json(); }
  catch {
    await logRefusal("gmail_push", "bad_request", 400, request);
    return NextResponse.json({ error: "Invalid Pub/Sub message." }, { status: 400 });
  }
  const notification = typeof body.message?.data === "string"
    ? parseGmailPushNotification(body.message.data)
    : null;
  if (!notification) {
    await logRefusal("gmail_push", "bad_request", 400, request);
    return NextResponse.json({ error: "Invalid Gmail notification." }, { status: 400 });
  }

  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch {
    await logRefusal("gmail_push", "not_configured", 503, request, "service role");
    return NextResponse.json({ error: "Service role is not configured." }, { status: 503 });
  }
  const { data: connections, error } = await supabase.from("integration_connection")
    .select("id, organization_id, user_id")
    .eq("provider", "gmail")
    .eq("status", "connected")
    .eq("external_account_id", notification.emailAddress);
  if (error) {
    await logRefusal("gmail_push", "db_error", 500, request, dbDetail(error));
    return NextResponse.json({ error: "Could not locate Gmail connection." }, { status: 500 });
  }
  let queued = 0;
  for (const connection of connections ?? []) {
    const { error: updateError } = await supabase.from("integration_secret")
      .update({ gmail_pending_history_id: notification.historyId, gmail_last_push_at: new Date().toISOString() })
      .eq("connection_id", connection.id);
    if (updateError) {
      await logRefusal("gmail_push", "db_error", 500, request, dbDetail(updateError));
      return NextResponse.json({ error: "Could not record Gmail notification." }, { status: 500 });
    }

    try {
      await enqueue(supabase, "integrations", {
        kind: "gmail_push",
        connection_id: connection.id,
        history_id: notification.historyId,
      });
      queued += 1;
    } catch (cause) {
      // The pending history id is already durable. A non-2xx response asks
      // Pub/Sub to redeliver, so queue failure cannot silently lose the push.
      await logRefusal("gmail_push", "queue_error", 503, request, cause instanceof Error ? cause.message : String(cause));
      return NextResponse.json({ error: "Could not queue Gmail reconciliation." }, { status: 503 });
    }
  }

  if (queued > 0) {
    // Run promptly after the webhook response. The queue plus the one-minute
    // scheduled worker remains the durable fallback if this process ends.
    after(async () => {
      try {
        const outcome = await runJob("gmail-push-sync");
        if (outcome.status === "failed") {
          logEvent("gmail_push.worker_failed", { runId: outcome.runId, error: outcome.error }, "error");
        }
      } catch (cause) {
        logEvent("gmail_push.worker_not_started", { error: cause instanceof Error ? cause.message : String(cause) }, "error");
      }
    });
  }

  return new NextResponse(null, { status: 204 });
}
