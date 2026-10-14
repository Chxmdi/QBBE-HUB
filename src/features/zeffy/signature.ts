import { createHmac, timingSafeEqual } from "node:crypto";
import { zeffyPaymentSchema, type ZeffyPayment } from "./types";

/**
 * Zeffy signs every webhook delivery with a `Zeffy-Signature` header of the
 * form `t=<unix seconds>,v1=<hex>`, where v1 is the HMAC-SHA256 of
 * `"{t}.{rawBody}"` keyed with the endpoint's signing secret (`whsec_...`,
 * used as is). The endpoint is public, so nothing in the body is trusted
 * until the signature and a fresh timestamp check out.
 */

export const ZEFFY_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function zeffySignatureIsValid(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > ZEFFY_SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export type ZeffyEventType =
  | "payment.completed"
  | "payment.created"
  | "payment.updated"
  | "payment.deleted"
  | "contact.created"
  | "contact.updated"
  | "contact.deleted";

const EVENT_TYPES = new Set<string>([
  "payment.completed",
  "payment.created",
  "payment.updated",
  "payment.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
]);

export interface ZeffyEvent {
  id: string;
  type: ZeffyEventType;
  /** The payment or contact the event is about. */
  resourceId: string;
  /** The full payment, when the event carries one that reads correctly. */
  payment: ZeffyPayment | null;
}

/** Reads a verified delivery. Anything the Hub does not handle is null. */
export function parseZeffyEvent(payload: unknown): ZeffyEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const { id, type, data } = payload as { id?: unknown; type?: unknown; data?: unknown };
  if (typeof id !== "string" || !id || id.length > 200) return null;
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return null;
  if (!data || typeof data !== "object") return null;
  const resourceId = (data as { id?: unknown }).id;
  if (typeof resourceId !== "string" || !resourceId || resourceId.length > 200) return null;

  let payment: ZeffyPayment | null = null;
  if (type === "payment.completed" || type === "payment.created") {
    const parsed = zeffyPaymentSchema.safeParse(data);
    payment = parsed.success ? parsed.data : null;
  }
  return { id, type: type as ZeffyEventType, resourceId, payment };
}
