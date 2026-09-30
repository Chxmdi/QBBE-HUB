import { createHash, randomBytes } from "node:crypto";

/**
 * Private API tokens (V2-8): `qbbe_` and 43 random base64url characters
 * (32 bytes). Only the SHA-256 hash is stored; the prefix is kept so people
 * can tell their tokens apart.
 */

export { apiScopes, isScope, type ApiScope } from "./scopes";

export const TOKEN_PREFIX = "qbbe_";
/** The longest a token may live, matching the table's check. */
export const MAX_TOKEN_DAYS = 365;

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The token in an `Authorization: Bearer …` header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(qbbe_[A-Za-z0-9_-]{43})\s*$/);
  return match ? match[1] : null;
}
