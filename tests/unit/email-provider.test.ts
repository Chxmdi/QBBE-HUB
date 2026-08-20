import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmailSendError,
  activeTransport,
  isRetryableStatus,
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
