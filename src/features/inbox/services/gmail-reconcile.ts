import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchGmailChangedMetadata,
  fetchGmailHistory,
  fetchGmailMetadata,
  fetchGmailProfile,
  refreshGoogleAccessToken,
} from "@/features/inbox/services/gmail-sync";

export interface GmailConnectionRef {
  id: string;
  organization_id: string;
  user_id: string;
}

export interface GmailReconcileResult {
  mode: "incremental" | "full";
  upserted: number;
  removed: number;
  historyId: string | null;
}

async function loadAccessToken(
  db: SupabaseClient,
  connectionId: string,
  now: Date,
): Promise<{
  accessToken: string;
  historyId: string | null;
  pendingHistoryId: string | null;
}> {
  const { data: secret, error } = await db
    .from("integration_secret")
    .select("access_token, refresh_token, token_expires_at, gmail_history_id, gmail_pending_history_id")
    .eq("connection_id", connectionId)
    .maybeSingle();

  if (error) throw new Error(`Could not load OAuth token: ${error.message}`);
  if (!secret?.access_token) throw new Error("Missing token for Gmail integration.");

  let accessToken = secret.access_token as string;
  const expiresAt = secret.token_expires_at
    ? new Date(secret.token_expires_at as string).getTime()
    : 0;

  if (expiresAt && expiresAt < now.getTime() + 60_000) {
    if (!secret.refresh_token) {
      throw new Error("Google access token expired and no refresh token is available.");
    }
    const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
    if (!refreshed?.access_token) {
      throw new Error("Google access token expired and could not be refreshed.");
    }
    accessToken = refreshed.access_token;
    const { error: updateError } = await db
      .from("integration_secret")
      .update({
        access_token: refreshed.access_token,
        token_expires_at: refreshed.expires_in
          ? new Date(now.getTime() + refreshed.expires_in * 1000).toISOString()
          : null,
      })
      .eq("connection_id", connectionId);
    if (updateError) {
      throw new Error(`Could not save refreshed OAuth token: ${updateError.message}`);
    }
  }

  return {
    accessToken,
    historyId: typeof secret.gmail_history_id === "string" ? secret.gmail_history_id : null,
    pendingHistoryId: typeof secret.gmail_pending_history_id === "string"
      ? secret.gmail_pending_history_id
      : null,
  };
}

async function upsertRows(
  db: SupabaseClient,
  connection: GmailConnectionRef,
  rows: Awaited<ReturnType<typeof fetchGmailMetadata>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await db.from("gmail_message").upsert(
    rows.map((row) => ({
      organization_id: connection.organization_id,
      user_id: connection.user_id,
      connection_id: connection.id,
      ...row,
    })),
    { onConflict: "user_id,external_id" },
  );
  if (error) throw new Error(`Could not save Gmail metadata: ${error.message}`);
  return rows.length;
}

async function deleteRows(
  db: SupabaseClient,
  connectionId: string,
  externalIds: string[],
): Promise<number> {
  if (externalIds.length === 0) return 0;
  const { error } = await db
    .from("gmail_message")
    .delete()
    .eq("connection_id", connectionId)
    .in("external_id", externalIds);
  if (error) throw new Error(`Could not remove stale Gmail metadata: ${error.message}`);
  return externalIds.length;
}

/**
 * Rebuilds a Gmail mirror without deleting the last known good state before a
 * successful provider read. Once the provider returns a complete Inbox, stale
 * local ids are removed after the replacement rows are safely upserted.
 */
async function fullMirror(
  db: SupabaseClient,
  connection: GmailConnectionRef,
  accessToken: string,
): Promise<{ upserted: number; removed: number; historyId: string | null }> {
  const rows = await fetchGmailMetadata(accessToken);
  const profile = await fetchGmailProfile(accessToken);

  const { data: existing, error: existingError } = await db
    .from("gmail_message")
    .select("external_id")
    .eq("connection_id", connection.id);
  if (existingError) {
    throw new Error(`Could not load existing Gmail metadata: ${existingError.message}`);
  }

  const upserted = await upsertRows(db, connection, rows);
  const currentIds = new Set(rows.map((row) => row.external_id));
  const staleIds = (existing ?? [])
    .map((row) => row.external_id as string)
    .filter((id) => !currentIds.has(id));
  const removed = await deleteRows(db, connection.id, staleIds);

  return { upserted, removed, historyId: profile.historyId };
}

/**
 * Reconciles one Gmail connection from its durable Gmail history cursor.
 *
 * The pending push cursor is only an urgency signal: correctness always comes
 * from Gmail's history API starting at the last committed history id. Clearing
 * the pending marker is compare-and-set so a newer push that arrives while this
 * sync is running is not erased by an older run finishing later.
 */
export async function reconcileGmailConnection(
  db: SupabaseClient,
  connection: GmailConnectionRef,
  now: Date,
): Promise<GmailReconcileResult> {
  const { accessToken, historyId, pendingHistoryId } = await loadAccessToken(db, connection.id, now);

  let result: GmailReconcileResult;

  if (!historyId) {
    const full = await fullMirror(db, connection, accessToken);
    result = { mode: "full", ...full };
  } else {
    try {
      const delta = await fetchGmailHistory(accessToken, historyId);
      const changed = await fetchGmailChangedMetadata(accessToken, delta.messageIds);
      const upserted = await upsertRows(db, connection, changed.rows);
      const removed = await deleteRows(db, connection.id, changed.removedIds);
      result = {
        mode: "incremental",
        upserted,
        removed,
        historyId: delta.historyId ?? historyId,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Gmail history failed.";
      if (!message.includes("full synchronization is required")) throw cause;
      const full = await fullMirror(db, connection, accessToken);
      result = { mode: "full", ...full };
    }
  }

  const { error: cursorError } = await db
    .from("integration_secret")
    .update({ gmail_history_id: result.historyId })
    .eq("connection_id", connection.id);
  if (cursorError) {
    throw new Error(`Could not save Gmail history cursor: ${cursorError.message}`);
  }

  // A newer push can land while provider calls are in flight. Only clear the
  // marker we observed; if it changed, the next queued push remains actionable.
  if (pendingHistoryId) {
    const { error: pendingError } = await db
      .from("integration_secret")
      .update({ gmail_pending_history_id: null })
      .eq("connection_id", connection.id)
      .eq("gmail_pending_history_id", pendingHistoryId);
    if (pendingError) {
      throw new Error(`Could not clear Gmail push cursor: ${pendingError.message}`);
    }
  }

  const { error: connectionError } = await db
    .from("integration_connection")
    .update({
      last_sync_at: now.toISOString(),
      last_error: null,
      status: "connected",
    })
    .eq("id", connection.id);
  if (connectionError) {
    throw new Error(`Could not record Gmail synchronization: ${connectionError.message}`);
  }

  return result;
}
