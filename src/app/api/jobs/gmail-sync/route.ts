import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  fetchCalendarOverlay,
  fetchGmailChangedMetadata,
  fetchGmailHistory,
  fetchGoogleDriveSync,
  fetchGmailMetadata,
  fetchGmailProfile,
  refreshGoogleAccessToken,
} from "@/features/inbox/services/gmail-sync";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import { recordJobRun } from "@/lib/job-observability";

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

  const { data: connections, error: connectionError } = await supabase
    .from("integration_connection")
    .select("id, user_id, organization_id, provider, status")
    .in("provider", ["gmail", "google_calendar", "google_drive"])
    .eq("status", "connected");
  if (connectionError) {
    console.error("Google sync could not load integration connections", { error: connectionError.message });
    return NextResponse.json({ error: "Could not load Google integration connections." }, { status: 500 });
  }

  let synced = 0;
  let failed = 0;

  for (const connection of connections ?? []) {
    const startedAt = new Date().toISOString();
    try {
      if (!connection.user_id) throw new Error("Google integration has no connected user.");
      const { data: secret, error: secretError } = await supabase
        .from("integration_secret")
        .select("access_token, refresh_token, token_expires_at, gmail_history_id, gmail_pending_history_id, google_calendar_sync_token, google_drive_page_token")
        .eq("connection_id", connection.id)
        .maybeSingle();
      if (secretError) throw new Error(`Could not load OAuth token: ${secretError.message}`);
      if (!secret?.access_token) throw new Error("Missing token for Google integration.");

      let accessToken = secret.access_token as string;
      const expires = secret.token_expires_at ? new Date(secret.token_expires_at as string).getTime() : 0;
      if (expires && expires < Date.now() + 60_000) {
        if (!secret.refresh_token) throw new Error("Google access token expired and no refresh token is available.");
        const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
        if (!refreshed?.access_token) throw new Error("Google access token expired and could not be refreshed.");
        accessToken = refreshed.access_token;
        const { error: tokenUpdateError } = await supabase.from("integration_secret").update({
          access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_in
            ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
            : null,
        }).eq("connection_id", connection.id);
        if (tokenUpdateError) throw new Error(`Could not save refreshed OAuth token: ${tokenUpdateError.message}`);
      }

      if (connection.provider === "gmail") {
        const saveRows = async (rows: Awaited<ReturnType<typeof fetchGmailMetadata>>) => {
          if (!rows.length) return;
          const { error } = await supabase.from("gmail_message").upsert(
            rows.map((row) => ({
              organization_id: connection.organization_id,
              user_id: connection.user_id,
              connection_id: connection.id,
              ...row,
            })),
            { onConflict: "user_id,external_id" },
          );
          if (error) throw new Error(`Could not save Gmail metadata: ${error.message}`);
        };
        const historyId = typeof secret.gmail_history_id === "string" ? secret.gmail_history_id : null;
        if (historyId) {
          try {
            const delta = await fetchGmailHistory(accessToken, historyId);
            const changed = await fetchGmailChangedMetadata(accessToken, delta.messageIds);
            await saveRows(changed.rows);
            if (changed.removedIds.length) {
              const { error } = await supabase.from("gmail_message")
                .delete()
                .eq("connection_id", connection.id)
                .in("external_id", changed.removedIds);
              if (error) throw new Error(`Could not remove stale Gmail metadata: ${error.message}`);
            }
            const { error } = await supabase.from("integration_secret")
              .update({ gmail_history_id: delta.historyId ?? historyId, gmail_pending_history_id: null })
              .eq("connection_id", connection.id);
            if (error) throw new Error(`Could not save Gmail history cursor: ${error.message}`);
          } catch (historyError) {
            const message = historyError instanceof Error ? historyError.message : "Gmail history failed.";
            if (!message.includes("full synchronization is required")) throw historyError;
            const rows = await fetchGmailMetadata(accessToken);
            await saveRows(rows);
            const profile = await fetchGmailProfile(accessToken);
            const { error } = await supabase.from("integration_secret")
              .update({ gmail_history_id: profile.historyId, gmail_pending_history_id: null })
              .eq("connection_id", connection.id);
            if (error) throw new Error(`Could not reset Gmail history cursor: ${error.message}`);
          }
        } else {
          const rows = await fetchGmailMetadata(accessToken);
          await saveRows(rows);
          const profile = await fetchGmailProfile(accessToken);
          const { error } = await supabase.from("integration_secret")
            .update({ gmail_history_id: profile.historyId, gmail_pending_history_id: null })
            .eq("connection_id", connection.id);
          if (error) throw new Error(`Could not initialize Gmail history cursor: ${error.message}`);
        }
      } else if (connection.provider === "google_calendar") {
        const saveCalendarSync = async (sync: Awaited<ReturnType<typeof fetchCalendarOverlay>>) => {
          if (sync.rows.length) {
            const { error } = await supabase.from("calendar_event_link").upsert(
              sync.rows.map((row) => ({
                organization_id: connection.organization_id,
                user_id: connection.user_id,
                connection_id: connection.id,
                ...row,
              })),
              { onConflict: "user_id,external_id" },
            );
            if (error) throw new Error(`Could not save Google Calendar overlay: ${error.message}`);
          }
          if (sync.removedIds.length) {
            const { error } = await supabase.from("calendar_event_link")
              .delete()
              .eq("connection_id", connection.id)
              .is("meeting_id", null)
              .is("event_id", null)
              .in("external_id", sync.removedIds);
            if (error) throw new Error(`Could not remove stale Google Calendar overlay: ${error.message}`);
          }
          const { error } = await supabase.from("integration_secret")
            .update({ google_calendar_sync_token: sync.syncToken })
            .eq("connection_id", connection.id);
          if (error) throw new Error(`Could not save Google Calendar sync token: ${error.message}`);
        };
        const syncToken = typeof secret.google_calendar_sync_token === "string"
          ? secret.google_calendar_sync_token
          : undefined;
        try {
          await saveCalendarSync(await fetchCalendarOverlay(accessToken, syncToken));
        } catch (calendarError) {
          const message = calendarError instanceof Error ? calendarError.message : "Google Calendar synchronization failed.";
          if (!syncToken || !message.includes("full synchronization is required")) throw calendarError;
          // Fetch before replacing the mirror so a transient Google failure
          // cannot discard the last known overlay.
          const fullSync = await fetchCalendarOverlay(accessToken);
          const { error } = await supabase.from("calendar_event_link")
            .delete()
            .eq("connection_id", connection.id)
            .is("meeting_id", null)
            .is("event_id", null);
          if (error) throw new Error(`Could not reset Google Calendar overlay: ${error.message}`);
          await saveCalendarSync(fullSync);
        }
      } else {
        const saveDriveSync = async (sync: Awaited<ReturnType<typeof fetchGoogleDriveSync>>) => {
          if (sync.rows.length) {
            const { error } = await supabase.from("document").upsert(
              sync.rows.map((row) => ({
              organization_id: connection.organization_id,
              title: row.title,
              description: row.description,
              kind: "link",
              url: row.url,
              mime_type: row.mime_type,
              visibility: "organization",
              owner_id: connection.user_id,
              created_by: connection.user_id,
              integration_connection_id: connection.id,
              external_id: row.external_id,
              external_updated_at: row.updated_at,
              })),
              { onConflict: "integration_connection_id,external_id" },
            );
            if (error) throw new Error(`Could not save Google Drive metadata: ${error.message}`);
          }
          if (sync.removedIds.length) {
            const { error } = await supabase.from("document")
              .delete()
              .eq("integration_connection_id", connection.id)
              .in("external_id", sync.removedIds);
            if (error) throw new Error(`Could not remove stale Google Drive metadata: ${error.message}`);
          }
          const { error } = await supabase.from("integration_secret")
            .update({ google_drive_page_token: sync.pageToken })
            .eq("connection_id", connection.id);
          if (error) throw new Error(`Could not save Google Drive page token: ${error.message}`);
        };
        const pageToken = typeof secret.google_drive_page_token === "string" ? secret.google_drive_page_token : undefined;
        try {
          await saveDriveSync(await fetchGoogleDriveSync(accessToken, pageToken));
        } catch (driveError) {
          const message = driveError instanceof Error ? driveError.message : "Google Drive synchronization failed.";
          if (!pageToken || !message.includes("full synchronization is required")) throw driveError;
          const fullSync = await fetchGoogleDriveSync(accessToken);
          const { error } = await supabase.from("document")
            .delete()
            .eq("integration_connection_id", connection.id);
          if (error) throw new Error(`Could not reset Google Drive metadata: ${error.message}`);
          await saveDriveSync(fullSync);
        }
      }
      const { error: connectionUpdateError } = await supabase
        .from("integration_connection")
        .update({ last_sync_at: new Date().toISOString(), last_error: null, status: "connected" })
        .eq("id", connection.id);
      if (connectionUpdateError) throw new Error(`Could not record synchronization: ${connectionUpdateError.message}`);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "google_sync",
        status: "succeeded",
        details: { provider: connection.provider, connectionId: connection.id },
        startedAt,
      });
      synced += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync failed";
      console.error("Google integration synchronization failed", { connectionId: connection.id, provider: connection.provider, error: message });
      await supabase
        .from("integration_connection")
        .update({ status: classifyIntegrationFailure(message), last_error: message })
        .eq("id", connection.id);
      await recordJobRun(supabase, {
        organizationId: connection.organization_id,
        jobName: "google_sync",
        status: "failed",
        details: { provider: connection.provider, connectionId: connection.id },
        error: message,
        startedAt,
      });
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, synced, failed });
}
