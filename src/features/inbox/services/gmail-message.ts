export interface GmailRawMessageInput {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}

/** Builds the RFC-2822 payload Gmail's send endpoint expects. */
export function buildGmailSendPayload(input: GmailRawMessageInput): {
  raw: string;
  threadId?: string;
} {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`);
  }
  const raw = Buffer.from(
    `${lines.join("\r\n")}\r\n\r\n${input.body}`,
    "utf8",
  ).toString("base64url");
  return { raw, ...(input.threadId ? { threadId: input.threadId } : {}) };
}
