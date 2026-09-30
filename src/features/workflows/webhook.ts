import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound webhooks (V1-12): signing, and refusing addresses a workflow must
 * never reach.
 *
 * Signature, in the `X-QBBE-Signature` header:
 *   t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the workflow's key>
 * A receiver recomputes it with the key shown on the workflow screen and
 * rejects a timestamp older than a few minutes, so a captured request cannot
 * be replayed later.
 *
 * Only https to a public address is allowed: a workflow is configured by an
 * admin but runs on the server, so it must not become a way to reach the
 * server's own network (server-side request forgery).
 */

export const WEBHOOK_TIMEOUT_MS = 10_000;
export const SIGNATURE_HEADER = "X-QBBE-Signature";

export function newWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signWebhook(secret: string, body: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Private, loopback, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(lower);
  }
  return true;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** https, no credentials, and every address the name resolves to is public. */
export async function checkWebhookUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true })).map((entry) => entry.address),
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid address" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https addresses are allowed" };
  if (url.username || url.password) return { ok: false, reason: "addresses with credentials are not allowed" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "private addresses are not allowed" };
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    return { ok: false, reason: "the address does not resolve" };
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    return { ok: false, reason: "private addresses are not allowed" };
  }
  return { ok: true, url };
}
