import { createHash, randomBytes } from "node:crypto";
import { absoluteUrl } from "@/lib/env";

/**
 * The secret an invitation is claimed with (SEC-001).
 *
 * 32 random bytes, sent to the invited address as a link. The invitation
 * keeps only its SHA-256 (`invitation.token_hash`), so a copy of that table, a
 * backup or an administrator's read cannot be replayed as an invitation.
 * `app.claimable_invitation` hashes the token a sign-up presents the same way.
 *
 * The secret does pass through the new account's user metadata: that is the
 * only way a sign-up can hand it to the database. `app.handle_new_user`
 * removes it as soon as it has been checked (and a trigger keeps it removed),
 * so it is not left on the account. The session issued by the sign-up request
 * itself still carries the spent secret until its first refresh.
 *
 * It also travels in the link's address, so it can land in the invitee's
 * browser history and the server's access logs; it works once, only for the
 * invited address, for INVITATION_LIFETIME_DAYS, and New link cancels it.
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
