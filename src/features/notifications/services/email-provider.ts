/**
 * Transactional email transport.
 *
 * Two transports, chosen by whether a provider key is configured:
 *
 *   resend — the real one. Called over plain fetch rather than an SDK, so the
 *            dependency surface stays at zero and the same code runs in Node
 *            and in an edge runtime.
 *   log    — used when no key is set. It records the message and reports
 *            success, so the whole pipeline (queue → rules → template →
 *            ledger) is exercisable in development and in CI without an
 *            account. The ledger row says `provider = 'log'`, so nobody can
 *            mistake a development run for a real send.
 *
 * Failures are classified. A transient one (network, 429, 5xx) is retried by
 * the queue; a permanent one (malformed address, rejected domain) is not,
 * because retrying it only burns attempts and delays the dead-letter signal.
 */

import { emailApiKey, emailFromAddress } from "@/lib/env";

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  provider: string;
  providerMessageId: string | null;
}

export class EmailSendError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, options: { retryable: boolean; status?: number | null }) {
    super(message);
    this.name = "EmailSendError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

/** Which transport this deployment will use. Surfaced in Admin → Email. */
export function activeTransport(): "resend" | "log" {
  return emailApiKey() ? "resend" : "log";
}

/** A 4xx other than 408/429 means the request itself is wrong; do not retry. */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

async function sendViaResend(email: OutboundEmail, apiKey: string): Promise<SendResult> {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFromAddress(),
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
  } catch (cause) {
    // Could not reach the provider at all — always worth another attempt.
    throw new EmailSendError(`email provider unreachable: ${String(cause)}`, {
      retryable: true,
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new EmailSendError(
      `email provider rejected the message (${response.status}): ${detail.slice(0, 300)}`,
      { retryable: isRetryableStatus(response.status), status: response.status },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: string };
  return { provider: "resend", providerMessageId: payload.id ?? null };
}

function sendViaLog(email: OutboundEmail): SendResult {
  console.info(
    JSON.stringify({
      event: "email.send",
      transport: "log",
      to: email.to,
      subject: email.subject,
      preview: email.text.slice(0, 200),
    }),
  );
  return { provider: "log", providerMessageId: null };
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  if (!email.to.includes("@")) {
    throw new EmailSendError(`not a deliverable address: ${email.to}`, {
      retryable: false,
    });
  }

  const apiKey = emailApiKey();
  return apiKey ? sendViaResend(email, apiKey) : sendViaLog(email);
}
