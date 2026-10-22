import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";
import { GOOGLE_PROVIDER_SCOPES, type GoogleIntegrationProvider } from "@/features/inbox/services/google-oauth";
import { googleFetch } from "@/features/inbox/services/google-fetch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  const t = await getT();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expected = cookieStore.get("qbbe_oauth_state")?.value;
  cookieStore.delete("qbbe_oauth_state");

  // Redirects go to the host the browser used. request.url is the server's
  // own address, which behind the proxy is localhost, where the person's
  // session cookie does not exist.
  const origin = requestOrigin(request);
  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/inbox?google_error=${encodeURIComponent(message)}`, origin),
    );

  if (!code || !state || !expected || state !== expected) {
    return fail(t("inbox.google.stateMismatch"));
  }
  const provider: GoogleIntegrationProvider = state.startsWith("google_calendar:")
    ? "google_calendar"
    : state.startsWith("google_drive:")
      ? "google_drive"
      : "gmail";
  const stateUser = state.split(":")[1];
  if (stateUser !== session.userId) {
    return fail(t("inbox.google.wrongUser"));
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail(t("inbox.google.credentialsMissing"));
  }

  const tokenRes = await googleFetch("https://oauth2.googleapis.com/token", {
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
    return fail(t("inbox.google.noTokens"));
  }
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) return fail(t("inbox.google.noAccessToken"));

  const supabase = await createSupabaseServerClient();
  const { data: connection, error } = await supabase
    .from("integration_connection")
    .upsert(
      {
        organization_id: session.organizationId,
        user_id: session.userId,
        provider,
        scopes: [...GOOGLE_PROVIDER_SCOPES[provider]],
        status: "connected",
        last_error: null,
        last_sync_at: null,
      },
      { onConflict: "organization_id,provider,user_id" },
    )
    .select("id")
    .single();
  if (error || !connection) {
    return fail(t("inbox.google.saveFailed"));
  }

  const expires = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;
  // Tokens cannot be read back through the API, so a plain upsert or update
  // with this session matches nothing. The database stores them for the
  // connection's owner, and keeps the stored refresh token when Google sends
  // none on a reconnect.
  const { error: secretError } = await supabase.rpc("store_integration_tokens", {
    p_connection: connection.id,
    p_access: tokens.access_token,
    p_refresh: tokens.refresh_token ?? null,
    p_expires: expires,
  });
  if (secretError) {
    await supabase
      .from("integration_connection")
      .update({ status: "error", last_error: "Token store failed." })
      .eq("id", connection.id);
    return fail(t("inbox.google.storeFailed"));
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
      const { error: cursorError } = await supabase.rpc("store_integration_sync_state", {
        p_connection: connection.id,
        p_state: {
          gmail_history_id: profile.historyId ?? watch?.historyId ?? null,
          gmail_pending_history_id: null,
          gmail_watch_expiration_at: watch?.expirationAt ?? null,
        },
      });
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
      const { error: cursorError } = await supabase.rpc("store_integration_sync_state", {
        p_connection: connection.id,
        p_state: { google_calendar_sync_token: sync.syncToken },
      });
      if (cursorError) throw new Error(`Could not save Google Calendar sync token: ${cursorError.message}`);
    } else {
      const { reconcileGoogleDrive } = await import("@/features/documents/services/google-drive-reconcile");
      const drive = await reconcileGoogleDrive(
        supabase,
        {
          id: connection.id,
          organization_id: session.organizationId,
          user_id: session.userId,
        },
        tokens.access_token,
      );
      // The reconcile's own cursor update cannot reach the row with this
      // session; save the page token through the database function.
      const { error: cursorError } = await supabase.rpc("store_integration_sync_state", {
        p_connection: connection.id,
        p_state: { google_drive_page_token: drive.pageToken },
      });
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
  return NextResponse.redirect(new URL(dest, origin));
}
