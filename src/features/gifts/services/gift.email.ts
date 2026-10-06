import {
  EmailSendError,
  recipientIsAllowed,
  sendEmail,
} from "@/features/notifications/services/email-provider";
import { letterBodyHtml } from "@/features/gifts/acknowledgement";
import type { MessageKey } from "@/lib/i18n/translate";

export interface EmailOutcome {
  ok: boolean;
  id: string;
  /** A catalogue key; the calling action translates it for the person. */
  error?: MessageKey;
}

export interface EmailDeps {
  /** Records the delivery status on the acknowledgement row. */
  mark: (fields: Record<string, unknown>) => Promise<void>;
  /** Why the provider told us never to mail this address again, if it did. */
  suppressedReason: (address: string) => Promise<string | null>;
  send?: typeof sendEmail;
  isAllowed?: (to: string) => boolean;
}

/**
 * Emails an issued letter through the app's existing sender (#156).
 *
 * The non-production recipient allowlist (EMAIL_RECIPIENT_ALLOWLIST) is
 * checked first, so outside production a donor's real address is never
 * mailed and the letter is recorded as "blocked" rather than as a failure.
 * An address the provider reported as bounced or complained is never mailed.
 * sendEmail applies the allowlist again as a backstop.
 */
export async function emailAcknowledgement(
  ack: { id: string; to: string; subject: string; text: string },
  deps: EmailDeps,
): Promise<EmailOutcome> {
  const send = deps.send ?? sendEmail;
  const isAllowed = deps.isAllowed ?? ((to: string) => recipientIsAllowed(to));

  if (!isAllowed(ack.to)) {
    await deps.mark({
      email_status: "blocked",
      email_error: "Recipient is not on this environment's email allowlist; nothing was sent.",
    });
    return {
      ok: false,
      id: ack.id,
      error: "finance.gifts.email.notAllowlisted",
    };
  }
  const suppressed = await deps.suppressedReason(ack.to.trim().toLowerCase());
  if (suppressed) {
    await deps.mark({ email_status: "blocked", email_error: `Address ${suppressed}; not mailed again.` });
    return {
      ok: false,
      id: ack.id,
      error: "finance.gifts.email.suppressed",
    };
  }
  try {
    await send({
      idempotencyKey: `gift-ack:${ack.id}`,
      to: ack.to,
      subject: ack.subject,
      text: ack.text,
      html: `<!doctype html><html><body style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:black;max-width:40rem;margin:0 auto;padding:24px">${letterBodyHtml(ack.text)}</body></html>`,
    });
  } catch (err) {
    const message = err instanceof EmailSendError ? err.message : "The email provider did not accept the message.";
    await deps.mark({ email_status: "failed", email_error: message.slice(0, 500) });
    return {
      ok: false,
      id: ack.id,
      error: "finance.gifts.email.sendFailed",
    };
  }
  await deps.mark({ email_status: "sent", sent_at: new Date().toISOString(), email_error: null });
  return { ok: true, id: ack.id };
}
