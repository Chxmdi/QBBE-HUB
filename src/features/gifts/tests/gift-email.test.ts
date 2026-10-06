import { afterEach, describe, expect, it, vi } from "vitest";
import { emailAcknowledgement } from "../services/gift.email";
import { DISCLAIMER_EN, DISCLAIMER_FR } from "../acknowledgement";

const ack = {
  id: "11111111-1111-1111-1111-111111111111",
  to: "donor@example.com",
  subject: "Merci pour votre don",
  text: `Merci.\n\n${DISCLAIMER_EN}\n${DISCLAIMER_FR}`,
};

function deps(overrides: Partial<Parameters<typeof emailAcknowledgement>[1]> = {}) {
  const marks: Record<string, unknown>[] = [];
  const send = vi.fn().mockResolvedValue({ provider: "log", providerMessageId: null });
  return {
    marks,
    send,
    deps: {
      mark: async (fields: Record<string, unknown>) => {
        marks.push(fields);
      },
      suppressedReason: async () => null,
      send,
      ...overrides,
    },
  };
}

afterEach(() => {
  delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
});

describe("emailing an acknowledgement", () => {
  it("never mails an address outside the non-production allowlist", async () => {
    process.env.EMAIL_RECIPIENT_ALLOWLIST = "@qbbe-qa.invalid";
    const t = deps();
    const result = await emailAcknowledgement(ack, t.deps);
    expect(result.ok).toBe(false);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.marks).toEqual([expect.objectContaining({ email_status: "blocked" })]);
  });

  it("does not mail an address that bounced or complained", async () => {
    const t = deps({ suppressedReason: async () => "bounced" });
    const result = await emailAcknowledgement(ack, t.deps);
    expect(result.ok).toBe(false);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.marks[0]).toMatchObject({ email_status: "blocked" });
  });

  it("sends an allowlisted address the letter with its disclaimer, once per acknowledgement", async () => {
    process.env.EMAIL_RECIPIENT_ALLOWLIST = "@example.com";
    const t = deps();
    const result = await emailAcknowledgement(ack, t.deps);
    expect(result.ok).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(1);
    const sent = t.send.mock.calls[0][0];
    expect(sent.idempotencyKey).toBe(`gift-ack:${ack.id}`);
    expect(sent.text).toContain(DISCLAIMER_EN);
    expect(sent.text).toContain(DISCLAIMER_FR);
    expect(sent.html).toContain("This is not an official donation receipt for income tax purposes.");
    expect(t.marks.at(-1)).toMatchObject({ email_status: "sent" });
  });

  it("records a provider failure without losing the issued letter", async () => {
    const t = deps({ send: vi.fn().mockRejectedValue(new Error("down")) });
    const result = await emailAcknowledgement(ack, t.deps);
    expect(result.ok).toBe(false);
    expect(t.marks.at(-1)).toMatchObject({ email_status: "failed" });
  });
});
