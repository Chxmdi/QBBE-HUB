import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshGoogleAccessToken } from "@/features/inbox/services/gmail-sync";
import {
  searchDrive,
  searchGmail,
  type ConnectedSource,
  type SourceOutcome,
} from "./google-search";

/**
 * Runs a connected-app search for ONE person with THEIR OWN Google tokens.
 *
 * The tokens live in integration_secret, which only the service role reads,
 * so `service` is the service-role client, and every lookup is pinned to
 * `userId` from the signed-in session: only connections whose user_id is that
 * person. Organization-wide connections (user_id null) are never used here,
 * so nobody searches through another account's view.
 */

const PROVIDER: Record<ConnectedSource, "google_drive" | "gmail"> = { drive: "google_drive", gmail: "gmail" };

interface SecretRow {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

async function tokenFor(
  service: SupabaseClient,
  userId: string,
  organizationId: string,
  source: ConnectedSource,
  now: Date,
): Promise<string | null> {
  const { data: connection } = await service
    .from("integration_connection")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("provider", PROVIDER[source])
    .eq("status", "connected")
    .maybeSingle();
  if (!connection?.id) return null;
  const { data: secret } = await service
    .from("integration_secret")
    .select("connection_id, access_token, refresh_token, token_expires_at")
    .eq("connection_id", connection.id)
    .maybeSingle();
  const row = secret as SecretRow | null;
  if (!row) return null;
  const expires = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (row.access_token && expires > now.getTime() + 60_000) return row.access_token;
  if (!row.refresh_token) return row.access_token;
  const refreshed = await refreshGoogleAccessToken(row.refresh_token);
  if (!refreshed?.access_token) return null;
  await service
    .from("integration_secret")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: refreshed.expires_in ? new Date(now.getTime() + refreshed.expires_in * 1000).toISOString() : null,
    })
    .eq("connection_id", row.connection_id);
  return refreshed.access_token;
}

export async function searchConnectedApps(input: {
  service: SupabaseClient;
  userId: string;
  organizationId: string;
  term: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<SourceOutcome[]> {
  const now = input.now ?? new Date();
  const run = async (source: ConnectedSource): Promise<SourceOutcome> => {
    try {
      const token = await tokenFor(input.service, input.userId, input.organizationId, source, now);
      if (!token) return { source, status: "not_connected" };
      const results =
        source === "drive"
          ? await searchDrive(token, input.term, input.fetchImpl)
          : await searchGmail(token, input.term, input.fetchImpl);
      return { source, status: "ok", results };
    } catch {
      // One service failing never hides the other's results.
      return { source, status: "unavailable" };
    }
  };
  return Promise.all([run("drive"), run("gmail")]);
}
