/** A production sender requires both a provider credential and verified From address. */
export function transactionalEmailIsLive(): boolean {
  return Boolean(process.env.EMAIL_PROVIDER_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

/** Local Mailpit path: used only when no production key is set. */
export function localMailpitEnabled(): boolean {
  return !process.env.EMAIL_PROVIDER_API_KEY;
}

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  /** Provider-supported request dedupe key; never include a recipient address. */
  idempotencyKey?: string;
}

/**
 * Sends through Resend's documented HTTP API by default. `EMAIL_PROVIDER_API_URL`
 * permits a compatible QBBE-approved transactional provider endpoint without
 * changing application code. Never return or log provider credentials.
 */
export async function sendProductionEmail(message: TransactionalEmail): Promise<string | null> {
  const key = process.env.EMAIL_PROVIDER_API_KEY;
  const from = process.env.EMAIL_FROM_ADDRESS;
  if (!key || !from) {
    throw new Error("Production email requires EMAIL_PROVIDER_API_KEY and EMAIL_FROM_ADDRESS.");
  }
  const endpoint = process.env.EMAIL_PROVIDER_API_URL ?? "https://api.resend.com/emails";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
  });
  const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new Error(`Transactional email provider rejected delivery (${response.status})${payload?.message ? `: ${payload.message}` : "."}`);
  }
  return payload?.id ?? null;
}
