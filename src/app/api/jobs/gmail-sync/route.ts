import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  fetchCalendarOverlay,
  fetchGmailMetadata,
  refreshGoogleAccessToken,
} from "@/features/inbox/services/gmail-sync";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Service role is not configured." }, { status: 503 });
  }

  const { data: connections } = await supabase
    .from("integration_connection")
    .select("id, user_id, organization_id, provider, status")
    .in("provider", ["gmail", "google_calendar"])
    .eq("status", "connected");

  let synced = 0;
  let failed = 0;

  for (const connection of connections ?? []) {
    if (!connection.user_id) continue;
    const { data: secret } = await supabase
      .from("integration_secret")
      .select("access_token, refresh_token, token_expires_at")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (!secret?.access_token) {
      failed += 1;
      continue;
    }

    let accessToken = secret.access_token as string;
    const expires = secret.token_expires_at ? new Date(secret.token_expires_at as string).getTime() : 0;
    if (expires && expires < Date.now() + 60_000 && secret.refresh_token) {
      const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
      if (refreshed?.access_token) {
        accessToken = refreshed.access_token;
        await supabase.from("integration_secret").update({
          access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
            : null,
        }).eq("connection_id", connection.id);
      }
    }

    try {
      if (connection.provider === "gmail") {
        const rows = await fetchGmailMetadata(accessToken);
        if (rows.length) {
          await supabase.from("gmail_message").upsert(
            rows.map((row) => ({
              organization_id: connection.organization_id,
              user_id: connection.user_id,
              connection_id: connection.id,
              ...row,
            })),
            { onConflict: "user_id,external_id" },
          );
        }
      } else {
        const rows = await fetchCalendarOverlay(accessToken);
        if (rows.length) {
          await supabase.from("calendar_event_link").upsert(
            rows.map((row) => ({
              organization_id: connection.organization_id,
              user_id: connection.user_id,
              connection_id: connection.id,
              ...row,
            })),
            { onConflict: "user_id,external_id" },
          );
        }
      }
      await supabase
        .from("integration_connection")
        .update({ last_sync_at: new Date().toISOString(), last_error: null, status: "connected" })
        .eq("id", connection.id);
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync failed";
      await supabase
        .from("integration_connection")
        .update({ status: "error", last_error: message })
        .eq("id", connection.id);
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, synced, failed });
}
