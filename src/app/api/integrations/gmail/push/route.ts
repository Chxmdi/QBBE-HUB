import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { gmailPushClaimsAreValid, parseGmailPushNotification } from "@/features/inbox/services/gmail-sync";

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
  if (!(await pubsubRequestAuthorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { message?: { data?: unknown } };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid Pub/Sub message." }, { status: 400 }); }
  const notification = typeof body.message?.data === "string"
    ? parseGmailPushNotification(body.message.data)
    : null;
  if (!notification) return NextResponse.json({ error: "Invalid Gmail notification." }, { status: 400 });

  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }
  const { data: connections, error } = await supabase.from("integration_connection")
    .select("id")
    .eq("provider", "gmail")
    .eq("status", "connected")
    .eq("external_account_id", notification.emailAddress);
  if (error) return NextResponse.json({ error: "Could not locate Gmail connection." }, { status: 500 });
  for (const connection of connections ?? []) {
    const { error: updateError } = await supabase.from("integration_secret")
      .update({ gmail_pending_history_id: notification.historyId, gmail_last_push_at: new Date().toISOString() })
      .eq("connection_id", connection.id);
    if (updateError) return NextResponse.json({ error: "Could not record Gmail notification." }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
