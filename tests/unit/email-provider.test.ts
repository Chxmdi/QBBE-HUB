import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmailSendError,
  activeTransport,
  isRetryableStatus,
  recipientIsAllowed,
  sendEmail,
  transactionalEmailIsLive,
} from "@/features/notifications/services/email-provider";

/**
 * Which transport runs, and which failures are worth retrying. Getting the
 * second wrong is expensive in both directions: retrying a rejected address
 * burns the attempt budget, and giving up on a 503 loses the message.
 */

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

function withEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("transport selection", () => {
  it("uses the provider whenever a key is set", () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test", SMTP_HOST: "127.0.0.1" });
    expect(activeTransport()).toBe("resend");
  });

  it("falls back to local SMTP when only a mail server is configured", () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: undefined, SMTP_HOST: "127.0.0.1" });
    expect(activeTransport()).toBe("smtp");
  });

  it("falls back to logging when there is neither", () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: undefined, SMTP_HOST: undefined });
    expect(activeTransport()).toBe("log");
  });
});

describe("transactionalEmailIsLive", () => {
  it("needs both a credential and a verified sender", () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test", EMAIL_FROM_ADDRESS: "hub@qbbe.org" });
    expect(transactionalEmailIsLive()).toBe(true);

    withEnv({ EMAIL_FROM_ADDRESS: undefined });
    expect(transactionalEmailIsLive()).toBe(false);

    withEnv({ EMAIL_PROVIDER_API_KEY: undefined, EMAIL_FROM_ADDRESS: "hub@qbbe.org" });
    expect(transactionalEmailIsLive()).toBe(false);
  });
});

describe("failure classification", () => {
  it("retries throttling, timeouts and server faults", () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("does not retry a request the provider says is wrong", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("sendEmail", () => {
  const message = {
    to: "person@example.org",
    subject: "Hello",
    text: "body",
    html: "<p>body</p>",
  };

  it("refuses an undeliverable address without contacting anyone", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail({ ...message, to: "nonsense" })).rejects.toBeInstanceOf(
      EmailSendError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the provider's message id on success", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test", EMAIL_FROM_ADDRESS: "hub@qbbe.org" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })),
    );

    await expect(sendEmail(message)).resolves.toEqual({
      provider: "resend",
      providerMessageId: "msg_1",
    });
  });

  it("marks an unreachable provider as retryable", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(sendEmail(message)).rejects.toMatchObject({ retryable: true });
  });

  it("marks a rejected message as permanent", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_test" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad address", { status: 422 })),
    );

    await expect(sendEmail(message)).rejects.toMatchObject({
      retryable: false,
      status: 422,
    });
  });

  it("never puts the credential in the error it raises", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: "re_super_secret_key" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rejected", { status: 500 })),
    );

    await expect(sendEmail(message)).rejects.toSatisfy(
      (error: Error) => !error.message.includes("re_super_secret_key"),
    );
  });

  it("logs rather than sending when nothing is configured", async () => {
    withEnv({ EMAIL_PROVIDER_API_KEY: undefined, SMTP_HOST: undefined });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(sendEmail(message)).resolves.toEqual({
      provider: "log",
      providerMessageId: null,
    });
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });
});

describe("recipient allowlist", () => {
  afterEach(() => {
    delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  });

  it("allows everyone when no allowlist is set, as production does", () => {
    expect(recipientIsAllowed("anyone@example.org")).toBe(true);
  });

  it("does not treat a domain that merely ends the same way as a match", () => {
    expect(recipientIsAllowed("a@evil-qbbe.org", ["@qbbe.org"])).toBe(false);
    expect(recipientIsAllowed("a@qbbe.org.evil.com", ["@qbbe.org"])).toBe(false);
    expect(recipientIsAllowed("a@QBBE.org", ["@qbbe.org"])).toBe(true);
  });

  it("refuses to send to anyone off the list, even when called directly", async () => {
    process.env.EMAIL_RECIPIENT_ALLOWLIST = "tester@qbbe.org";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail({
      to: "real.person@example.org",
      subject: "Test",
      text: "Test",
      html: "Test",
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the log stand-in", () => {
  const email = { to: "donor@example.com", subject: "Thank you, Jane", text: "Dear Jane, your gift of $100", html: "<p>Dear Jane</p>" };

  it("is refused in production unless explicitly chosen, so nothing looks sent that was not", async () => {
    withEnv({ NODE_ENV: "production", EMAIL_PROVIDER_API_KEY: undefined, SMTP_HOST: undefined, EMAIL_TRANSPORT: undefined });
    const failure = await sendEmail(email).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailSendError);
    expect((failure as EmailSendError).retryable).toBe(false);
    expect((failure as Error).message).toMatch(/not configured/);
  });

  it("writes neither the address nor the content to the log", async () => {
    withEnv({ NODE_ENV: "production", EMAIL_PROVIDER_API_KEY: undefined, SMTP_HOST: undefined, EMAIL_TRANSPORT: "log" });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(sendEmail(email)).resolves.toMatchObject({ provider: "log" });
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("donor@example.com");
    expect(logged).not.toContain("Jane");
    expect(logged).toMatch(/"recipient_sha256":"[0-9a-f]{64}"/);
    info.mockRestore();
  });

  it("does not put a malformed address in the error it records", async () => {
    const failure = await sendEmail({ ...email, to: "jane at example" }).catch((error: unknown) => error);
    expect((failure as Error).message).not.toContain("jane at example");
  });
});
