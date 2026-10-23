import type { JobContext, JobResult } from "../runner";
import { currentKeyId, needsResealing, openToken, sealToken } from "@/features/inbox/services/google-token-crypto";
import { revokeQueuedGoogleTokens } from "@/features/inbox/services/google-revoke";

/**
 * Keeps stored Google tokens sealed and revokes deleted ones (PRIV-011).
 *
 * 1. Seals any token stored in the clear (from before encryption) and reseals
 *    any sealed with GOOGLE_TOKEN_KEY_PREVIOUS after a rotation. Idempotent:
 *    a row already sealed with the current key is left alone.
 * 2. Asks Google to revoke the tokens queued when their rows were deleted.
 */
export async function googleTokenUpkeep({ db, definition }: JobContext): Promise<JobResult> {
  // Only rows with a token not sealed under the current key, a batch at a time.
  const current = `enc:v1:${currentKeyId()}:*`;
  const { data, error } = await db
    .from("integration_secret")
    .select("connection_id, access_token, refresh_token")
    .or(`access_token.not.like.${current},refresh_token.not.like.${current}`)
    .order("connection_id", { ascending: true })
    .limit(definition.batch_size);
  if (error) throw new Error(`Could not read the stored Google tokens: ${error.message}`);

  let sealed = 0;
  let unreadable = 0;
  for (const row of (data ?? []) as { connection_id: string; access_token: string | null; refresh_token: string | null }[]) {
    if (!needsResealing(row.access_token) && !needsResealing(row.refresh_token)) continue;
    let update: { access_token: string | null; refresh_token: string | null };
    try {
      const access = openToken(row.access_token, row.connection_id);
      const refresh = openToken(row.refresh_token, row.connection_id);
      update = {
        access_token: access === null ? null : sealToken(access, row.connection_id),
        refresh_token: refresh === null ? null : sealToken(refresh, row.connection_id),
      };
    } catch {
      // Sealed with a key the server no longer holds: nobody can use these
      // tokens again. Delete them (which queues their revocation, recorded
      // as unreadable) and ask the person to reconnect, so the row stops
      // coming back here and holding up the rest.
      unreadable += 1;
      const { error: dropError } = await db.from("integration_secret").delete().eq("connection_id", row.connection_id);
      if (dropError) throw new Error(`Could not remove an unreadable Google token: ${dropError.message}`);
      const { error: markError } = await db
        .from("integration_connection")
        .update({ status: "error", last_error: "Reconnect: the stored Google authorization can no longer be read." })
        .eq("id", row.connection_id);
      if (markError) throw new Error(`Could not mark a connection for reconnecting: ${markError.message}`);
      continue;
    }
    // Only if the row still holds what was read: a sync that refreshed the
    // token meanwhile wrote a newer one, which must not be overwritten.
    let write = db.from("integration_secret").update(update).eq("connection_id", row.connection_id);
    write = row.access_token === null ? write.is("access_token", null) : write.eq("access_token", row.access_token);
    write = row.refresh_token === null ? write.is("refresh_token", null) : write.eq("refresh_token", row.refresh_token);
    const { error: writeError } = await write;
    if (writeError) throw new Error(`Could not seal a stored Google token: ${writeError.message}`);
    sealed += 1;
  }

  const revocation = await revokeQueuedGoogleTokens(db, { limit: definition.batch_size });
  return {
    processed: sealed + revocation.revoked,
    failed: unreadable + revocation.failed,
    metadata: { sealed, unreadable, revoked: revocation.revoked, revoke_failed: revocation.failed },
  };
}
