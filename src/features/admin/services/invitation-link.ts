import { createHash, randomBytes } from "node:crypto";
import { absoluteUrl } from "@/lib/env";

/**
 * The secret an invitation is claimed with (SEC-001).
 *
 * 32 random bytes, sent to the invited address as a link. Only its SHA-256
 * reaches the database (`invitation.token_hash`), so a copy of the table,
 * a backup or an administrator's read cannot be replayed as an invitation.
 * `app.claimable_invitation` hashes the token a sign-up presents the same way.
 */
export interface InvitationSecret {
  token: string;
  tokenHash: string;
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createInvitationSecret(): InvitationSecret {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** The link the invitee opens; the sign-up page reads `?invite=`. */
export function invitationLink(token: string): string {
  return absoluteUrl(`/sign-up?invite=${encodeURIComponent(token)}`);
}

/** How long a fresh invitation link stays usable. Matches the table default. */
export const INVITATION_LIFETIME_DAYS = 14;
