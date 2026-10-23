import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Google OAuth tokens are encrypted before they reach the database (PRIV-011).
 *
 * The key is GOOGLE_TOKEN_KEY: 32 random bytes in base64, held by the server
 * only (never in the database or the repository; docs/runbooks/integrations.md
 * says how to make and rotate it). A stored value is
 *
 *   enc:v1:<key id>:<iv>:<tag>:<ciphertext>
 *
 * AES-256-GCM, base64url parts, the key id being the first 8 hex characters of
 * the key's SHA-256. The connection id is authenticated with it, so a value
 * copied onto another connection does not open. During a rotation,
 * GOOGLE_TOKEN_KEY_PREVIOUS opens values the old key sealed, and the
 * google-token-upkeep job seals them again with the new one.
 *
 * Server code only: the Google services and jobs, which read the tokens with
 * the service role. Nobody signed in can read the tokens at all.
 */

export class GoogleTokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTokenKeyError";
  }
}

const PREFIX = "enc:v1:";

// Exactly 32 bytes in standard base64, as `openssl rand -base64 32` prints
// them: Node's decoder skips stray characters, so the shape is checked first.
const KEY_SHAPE = /^[A-Za-z0-9+/]{43}=$/;

function decodeKey(value: string | undefined): Buffer | null {
  const trimmed = value?.trim();
  if (!trimmed || !KEY_SHAPE.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed, "base64");
  return bytes.length === 32 ? bytes : null;
}

const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);

/** The problem with the key settings, in one sentence that names no value; null when they are fine. */
export function tokenKeyProblem(env: Record<string, string | undefined> = process.env): string | null {
  if (!decodeKey(env.GOOGLE_TOKEN_KEY)) return "GOOGLE_TOKEN_KEY is missing or is not 32 bytes in base64.";
  if (env.GOOGLE_TOKEN_KEY_PREVIOUS && !decodeKey(env.GOOGLE_TOKEN_KEY_PREVIOUS)) {
    return "GOOGLE_TOKEN_KEY_PREVIOUS is set but is not 32 bytes in base64.";
  }
  return null;
}

function currentKey(): Buffer {
  const key = decodeKey(process.env.GOOGLE_TOKEN_KEY);
  if (!key) throw new GoogleTokenKeyError("GOOGLE_TOKEN_KEY is missing or is not 32 bytes in base64.");
  return key;
}

function keyFor(id: string): Buffer {
  for (const candidate of [process.env.GOOGLE_TOKEN_KEY, process.env.GOOGLE_TOKEN_KEY_PREVIOUS]) {
    const key = decodeKey(candidate);
    if (key && keyId(key) === id) return key;
  }
  throw new GoogleTokenKeyError("This Google token was sealed with a key the server no longer holds.");
}

/** The id of the current key, as stored values name it. */
export const currentKeyId = (): string => keyId(currentKey());

/** True for a value in the sealed form. */
export const isSealed = (stored: string | null | undefined): boolean => Boolean(stored?.startsWith(PREFIX));

/** The stored form of a token, for the connection it belongs to. */
export function sealToken(plain: string, connectionId: string): string {
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(connectionId));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${keyId(key)}:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * The token a stored value holds. A value stored before encryption (no
 * prefix) is returned as it is until the upkeep job seals it; the database
 * refuses any new one.
 */
export function openToken(stored: string | null | undefined, connectionId: string): string | null {
  if (stored == null || stored === "") return null;
  if (!isSealed(stored)) return stored;
  const [id, iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":");
  if (!id || !iv || !tag || !ciphertext) throw new GoogleTokenKeyError("This Google token is not in the expected form.");
  // The full 16-byte tag: a shortened one would weaken the check.
  const decipher = createDecipheriv("aes-256-gcm", keyFor(id), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(connectionId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** True when a stored value is plaintext or sealed with a key other than the current one. */
export function needsResealing(stored: string | null | undefined): boolean {
  if (stored == null || stored === "") return false;
  if (!isSealed(stored)) return true;
  return stored.slice(PREFIX.length).split(":")[0] !== keyId(currentKey());
}
