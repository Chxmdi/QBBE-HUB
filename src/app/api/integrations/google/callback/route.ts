import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("qbbe_oauth_state")?.value;
  cookieStore.delete("qbbe_oauth_state");

  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/inbox?google_error=${encodeURIComponent(message)}`, request.url),
    );

  if (!code || !state || !expected || state !== expected) {
    return fail("OAuth state mismatch. Try connecting again.");
  }
  const provider = state.startsWith("google_calendar:")
    ? "google_calendar"
    : state.startsWith("google_drive:")
      ? "google_drive"
      : "gmail";
  const stateUser = state.split(":")[1];
  if (stateUser !== session.userId) {
    return fail("OAuth state did not match the signed-in user.");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail("Google credentials are not configured.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return fail("Google did not issue tokens. Check the OAuth client configuration.");
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) return fail("Google response was missing an access token.");

  const supabase = await createSupabaseServerClient();
  const { data: connection, error } = await supabase
    .from("integration_connection")
    .upsert(
      {
        organization_id: session.organizationId,
        user_id: session.userId,
        provider,
        status: "connected",
        last_error: null,
        last_sync_at: null,
      },
      { onConflict: "organization_id,provider,user_id" },
    )
    .select("id")
    .single();
  if (error || !connection) {
    return fail("Could not save the connection record.");
  }

  const expires = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  const secretPayload = {
    connection_id: connection.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: expires,
  };
  const { error: secretError } = await supabase
    .from("integration_secret")
    .upsert(secretPayload, { onConflict: "connection_id" });
  if (secretError) {
    await supabase
      .from("integration_connection")
      .update({ status: "error", last_error: "Token store failed." })
      .eq("id", connection.id);
    return fail("Connected, but tokens could not be stored. Disconnect and retry.");
  }

  try {
    if (provider === "gmail") {
      const { createGmailInboxWatch, fetchGmailMetadata, fetchGmailProfile } = await import("@/features/inbox/services/gmail-sync");
      const profile = await fetchGmailProfile(tokens.access_token);
      const { error: accountError } = await supabase.from("integration_connection")
        .update({ external_account_id: profile.emailAddress })
        .eq("id", connection.id);
      if (accountError) throw new Error("Could not save the connected Gmail address.");
      const rows = await fetchGmailMetadata(tokens.access_token);
      if (rows.length) {
        const { error: messageError } = await supabase.from("gmail_message").upsert(
          rows.map((row) => ({
            organization_id: session.organizationId,
            user_id: session.userId,
            connection_id: connection.id,
            ...row,
          })),
          { onConflict: "user_id,external_id" },
        );
        if (messageError) throw new Error(`Could not save Gmail metadata: ${messageError.message}`);
      }
      const topicName = process.env.GOOGLE_GMAIL_PUBSUB_TOPIC;
      const pushConfigured = Boolean(
        topicName && process.env.GOOGLE_GMAIL_PUBSUB_AUDIENCE && process.env.GOOGLE_GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL,
      );
      const watch = pushConfigured
        ? await createGmailInboxWatch(tokens.access_token, topicName!)
        : null;
      const { error: cursorError } = await supabase.from("integration_secret")
        .update({
          gmail_history_id: profile.historyId ?? watch?.historyId ?? null,
          gmail_pending_history_id: null,
          gmail_watch_expiration_at: watch?.expirationAt ?? null,
        })
        .eq("connection_id", connection.id);
      if (cursorError) throw new Error(`Could not save Gmail synchronization state: ${cursorError.message}`);
    } else if (provider === "google_calendar") {
      const { fetchCalendarOverlay } = await import("@/features/inbox/services/gmail-sync");
      const sync = await fetchCalendarOverlay(tokens.access_token);
      // A reconnect starts a new full mirror. Clear only imported overlays;
      // linked Hub meetings/events remain durable sources of truth.
      const { error: resetError } = await supabase.from("calendar_event_link")
        .delete()
        .eq("connection_id", connection.id)
        .is("meeting_id", null)
        .is("event_id", null);
      if (resetError) throw new Error(`Could not reset Google Calendar overlay: ${resetError.message}`);
      if (sync.rows.length) {
        const { error: calendarError } = await supabase.from("calendar_event_link").upsert(
          sync.rows.map((row) => ({
            organization_id: session.organizationId,
            user_id: session.userId,
            connection_id: connection.id,
            ...row,
          })),
          { onConflict: "user_id,external_id" },
        );
        if (calendarError) throw new Error(`Could not save Google Calendar overlay: ${calendarError.message}`);
      }
      const { error: cursorError } = await supabase.from("integration_secret")
        .update({ google_calendar_sync_token: sync.syncToken })
        .eq("connection_id", connection.id);
      if (cursorError) throw new Error(`Could not save Google Calendar sync token: ${cursorError.message}`);
    } else {
      const { fetchGoogleDriveSync } = await import("@/features/inbox/services/gmail-sync");
      const sync = await fetchGoogleDriveSync(tokens.access_token);
      const { error: resetError } = await supabase.from("document")
        .delete()
        .eq("integration_connection_id", connection.id);
      if (resetError) throw new Error(`Could not reset Google Drive metadata: ${resetError.message}`);
      if (sync.rows.length) {
        const { error: driveError } = await supabase.from("document").upsert(
          sync.rows.map((row) => ({
            organization_id: session.organizationId,
            title: row.title,
            description: row.description,
            kind: "link",
            url: row.url,
            mime_type: row.mime_type,
            visibility: "organization",
            owner_id: session.userId,
            created_by: session.userId,
            integration_connection_id: connection.id,
            external_id: row.external_id,
            external_updated_at: row.updated_at,
          })),
          { onConflict: "integration_connection_id,external_id" },
        );
        if (driveError) throw new Error(`Could not save Google Drive metadata: ${driveError.message}`);
      }
      const { error: cursorError } = await supabase.from("integration_secret")
        .update({ google_drive_page_token: sync.pageToken })
        .eq("connection_id", connection.id);
      if (cursorError) throw new Error(`Could not save Google Drive page token: ${cursorError.message}`);
    }
    await supabase
      .from("integration_connection")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("id", connection.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Initial sync failed.";
    await supabase
      .from("integration_connection")
      .update({ status: "error", last_error: message })
      .eq("id", connection.id);
  }

  const dest = provider === "gmail" ? "/inbox?filter=mail" : provider === "google_calendar" ? "/calendar" : "/documents";
  return NextResponse.redirect(new URL(dest, request.url));
}
