import { describe, expect, it } from "vitest";
import { buildGmailSendPayload } from "@/features/inbox/services/gmail-message";
import { GOOGLE_PROVIDER_SCOPES } from "@/features/inbox/services/google-oauth";

describe("Gmail send payload", () => {
  it("builds a standalone compose message without thread metadata", () => {
    const payload = buildGmailSendPayload({
      to: "recipient@example.org",
      subject: "Hello",
      body: "Body text",
    });
    const decoded = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: recipient@example.org");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Content-Transfer-Encoding: 8bit");
    expect(decoded).toContain("\r\n\r\nBody text");
    expect(payload.threadId).toBeUndefined();
  });

  it("keeps Gmail thread and RFC reply headers together for replies", () => {
    const payload = buildGmailSendPayload({
      to: "sender@example.org",
      subject: "Re: Partnership",
      body: "Reply",
      threadId: "thread-1",
      inReplyTo: "<message-1@example.org>",
    });
    const decoded = Buffer.from(payload.raw, "base64url").toString("utf8");
    expect(payload.threadId).toBe("thread-1");
    expect(decoded).toContain("In-Reply-To: <message-1@example.org>");
    expect(decoded).toContain("References: <message-1@example.org>");
  });
});

describe("Google OAuth scopes", () => {
  it("uses readonly plus send for Gmail and does not request mailbox-modify scope", () => {
    expect(GOOGLE_PROVIDER_SCOPES.gmail).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(GOOGLE_PROVIDER_SCOPES.gmail).not.toContain(
      "https://www.googleapis.com/auth/gmail.modify",
    );
  });
});
