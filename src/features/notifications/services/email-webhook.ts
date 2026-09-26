import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend reports what happened to a message after it was accepted — a hard
 * bounce, a spam complaint — through a webhook signed the Svix way: an
 * HMAC-SHA256 over `id.timestamp.body`, keyed with the endpoint's `whsec_`
 * secret and sent as one or more `v1,<base64>` entries.
 *
 * Nothing here trusts the body until the signature and a fresh timestamp
 * check out, because the endpoint is public and the effect of a forged event
 * is to stop mail reaching someone.
 */

const TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function resendSignatureIsValid(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) {
    return false;
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  return headers.signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export type ProviderEmailEvent =
  | { kind: "bounced"; messageId: string | null; addresses: string[]; permanent: boolean; detail: string | null }
  | { kind: "complained"; messageId: string | null; addresses: string[] }
  | { kind: "ignored" };

/** Reads the parts of a Resend event the Hub acts on. Anything else is ignored. */
export function parseResendEvent(payload: unknown): ProviderEmailEvent {
  if (!payload || typeof payload !== "object") return { kind: "ignored" };
  const { type, data } = payload as { type?: unknown; data?: Record<string, unknown> };
  if (!data || typeof data !== "object") return { kind: "ignored" };

  const messageId = typeof data.email_id === "string" ? data.email_id : null;
  const to = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  const addresses = to
    .filter((value): value is string => typeof value === "string" && value.includes("@"))
    .map((value) => value.trim().toLowerCase());

  if (type === "email.bounced") {
    const bounce = (data.bounce ?? {}) as { type?: unknown; message?: unknown };
    return {
      kind: "bounced",
      messageId,
      addresses,
      // A soft (transient) bounce is a mailbox that may recover; only a hard
      // bounce means the address should never be tried again.
      permanent: typeof bounce.type !== "string" || bounce.type.toLowerCase() !== "transient",
      detail: typeof bounce.message === "string" ? bounce.message.slice(0, 500) : null,
    };
  }
  if (type === "email.complained") return { kind: "complained", messageId, addresses };
  return { kind: "ignored" };
}
