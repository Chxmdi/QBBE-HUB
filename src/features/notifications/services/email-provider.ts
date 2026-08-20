/**
 * Transactional email transport.
 *
 * Three transports, chosen by what the environment actually provides:
 *
 *   resend — the real one, used whenever a provider key is set. Called over
 *            plain fetch rather than an SDK, so the dependency surface stays at
 *            zero and the same code runs in Node and in an edge runtime.
 *   smtp   — local Mailpit (`supabase start` exposes SMTP on :54325). Used when
 *            SMTP_HOST is set and no provider key is, so a developer can read
 *            the actual message rather than a log line.
 *   log    — the last resort. It records the message and reports success, so
 *            the whole pipeline (queue → rules → template → ledger) is
 *            exercisable in CI with no account and no mail server.
 *
 * The ledger records which transport ran, so a development send can never be
 * mistaken for a real one.
 *
 * Failures are classified. A transient one (network, 429, 5xx) is retried by
 * the queue; a permanent one (malformed address, rejected domain) is not,
 * because retrying it only burns attempts and delays the dead-letter signal.
 */

import { emailApiKey, emailFromAddress } from "@/lib/env";
import { sendSmtpMail } from "@/lib/smtp";

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
export function activeTransport(): "resend" | "smtp" | "log" {
  if (emailApiKey()) return "resend";
  return process.env.SMTP_HOST ? "smtp" : "log";
}

/**
 * A production sender needs both a credential and a verified From address.
 * Admin surfaces use this to say plainly whether email is really going out.
 */
export function transactionalEmailIsLive(): boolean {
  return Boolean(process.env.EMAIL_PROVIDER_API_KEY && process.env.EMAIL_FROM_ADDRESS);
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

async function sendViaSmtp(email: OutboundEmail): Promise<SendResult> {
  try {
    await sendSmtpMail({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 54325),
      from: emailFromAddress(),
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  } catch (cause) {
    // A local mail server being down is transient by nature.
    throw new EmailSendError(`SMTP delivery failed: ${String(cause)}`, {
      retryable: true,
    });
  }
  return { provider: "smtp", providerMessageId: null };
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
  if (apiKey) return sendViaResend(email, apiKey);
  if (process.env.SMTP_HOST) return sendViaSmtp(email);
  return sendViaLog(email);
}
