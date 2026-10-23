import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit-write";
import { logEvent } from "@/lib/server-log";
import { googleFetch, GoogleFetchError } from "@/features/inbox/services/google-fetch";
import { openToken } from "@/features/inbox/services/google-token-crypto";

/**
 * Asks Google to revoke tokens Hub no longer keeps (PRIV-011).
 *
 * Every deleted integration_secret row leaves its token in
 * google_token_revocation (a database trigger, so disconnecting, deactivating
 * the member and deleting the connection all count). Revocation is best
 * effort: once Google has answered (revoked, or refused), or after
 * MAX_ATTEMPTS tries that could not reach it, the outcome is logged and
 * audited and the queued copy is deleted. Until then, and when the audit
 * record cannot be written, the copy stays for the next run.
 *
 * Runs with the service role (the queue is readable by nobody else).
 */

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const MAX_ATTEMPTS = 5;

type Outcome = "revoked" | "refused" | "unreachable" | "unreadable";

interface QueuedToken {
  id: string;
  connection_id: string;
  organization_id: string | null;
  user_id: string | null;
  provider: string | null;
  token: string;
  attempts: number;
}

async function revokeAtGoogle(token: string): Promise<{ outcome: Outcome; status: number | null }> {
  try {
    // Revoking an already revoked token changes nothing, so repeats are safe.
    const response = await googleFetch(
      REVOKE_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      },
      { retryUnsafe: true },
    );
    return { outcome: response.ok ? "revoked" : "refused", status: response.status };
  } catch (error) {
    return { outcome: "unreachable", status: error instanceof GoogleFetchError ? error.status : null };
  }
}

export async function revokeQueuedGoogleTokens(
  db: SupabaseClient,
  options: { connectionId?: string; limit?: number } = {},
): Promise<{ revoked: number; failed: number }> {
  let query = db
    .from("google_token_revocation")
    .select("id, connection_id, organization_id, user_id, provider, token, attempts")
    .order("queued_at", { ascending: true })
    .limit(options.limit ?? 200);
  if (options.connectionId) query = query.eq("connection_id", options.connectionId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the Google token revocation queue: ${error.message}`);

  let revoked = 0;
  let failed = 0;
  for (const row of (data ?? []) as QueuedToken[]) {
    let result: { outcome: Outcome; status: number | null };
    try {
      const token = openToken(row.token, row.connection_id);
      result = token ? await revokeAtGoogle(token) : { outcome: "unreadable", status: null };
    } catch {
      // Sealed with a key the server no longer holds: nothing to send.
      result = { outcome: "unreadable", status: null };
    }
    logEvent(
      "google.token_revoke",
      { connection_id: row.connection_id, provider: row.provider, outcome: result.outcome, status: result.status, attempt: (row.attempts ?? 0) + 1 },
      result.outcome === "revoked" ? "info" : "warn",
    );
    if (result.outcome === "revoked") revoked += 1;
    else failed += 1;
    // Google could not be reached: try again next run, up to MAX_ATTEMPTS.
    if (result.outcome === "unreachable" && (row.attempts ?? 0) + 1 < MAX_ATTEMPTS) {
      const { error: retryError } = await db
        .from("google_token_revocation")
        .update({ attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id);
      if (retryError) logEvent("google.token_revoke_retry_failed", { connection_id: row.connection_id, error: retryError.message }, "error");
      continue;
    }
    const audited = await recordAudit(db, {
      organization_id: row.organization_id,
      actor_id: row.user_id,
      actor_type: "system",
      event_type: "integration",
      action: result.outcome === "revoked" ? "google_token_revoked" : "google_token_revoke_failed",
      object_type: "integration_connection",
      object_id: row.connection_id,
      metadata: { provider: row.provider, outcome: result.outcome, status: result.status, attempts: (row.attempts ?? 0) + 1 },
    });
    if (!audited) continue;
    const { error: deleteError } = await db.from("google_token_revocation").delete().eq("id", row.id);
    // Left queued, it is tried again next run (revoking twice changes nothing).
    if (deleteError) logEvent("google.token_revoke_dequeue_failed", { connection_id: row.connection_id, error: deleteError.message }, "error");
  }
  return { revoked, failed };
}
