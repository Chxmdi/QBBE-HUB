import { afterEach, describe, expect, it, vi } from "vitest";
import { localMailpitEnabled, sendProductionEmail, transactionalEmailIsLive } from "@/lib/email-provider";

const originalKey = process.env.EMAIL_PROVIDER_API_KEY;
const originalFrom = process.env.EMAIL_FROM_ADDRESS;
const originalUrl = process.env.EMAIL_PROVIDER_API_URL;

afterEach(() => {
  if (originalKey === undefined) delete process.env.EMAIL_PROVIDER_API_KEY;
  else process.env.EMAIL_PROVIDER_API_KEY = originalKey;
  if (originalFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
  else process.env.EMAIL_FROM_ADDRESS = originalFrom;
  if (originalUrl === undefined) delete process.env.EMAIL_PROVIDER_API_URL;
  else process.env.EMAIL_PROVIDER_API_URL = originalUrl;
  vi.unstubAllGlobals();
});

describe("email provider honesty", () => {
  it("requires a credential and verified sender before claiming production delivery", () => {
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    expect(transactionalEmailIsLive()).toBe(false);
    process.env.EMAIL_PROVIDER_API_KEY = "re_test";
    expect(transactionalEmailIsLive()).toBe(false);
    process.env.EMAIL_FROM_ADDRESS = "hub@example.org";
    expect(transactionalEmailIsLive()).toBe(true);
  });

  it("uses Mailpit only when EMAIL_PROVIDER_API_KEY is unset", () => {
    const previous = process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.EMAIL_PROVIDER_API_KEY;
    expect(localMailpitEnabled()).toBe(true);
    process.env.EMAIL_PROVIDER_API_KEY = "sg-test";
    expect(localMailpitEnabled()).toBe(false);
    if (previous === undefined) delete process.env.EMAIL_PROVIDER_API_KEY;
    else process.env.EMAIL_PROVIDER_API_KEY = previous;
  });

  it("sends the provider payload without exposing the API key in the body", async () => {
    process.env.EMAIL_PROVIDER_API_KEY = "re_test";
    process.env.EMAIL_FROM_ADDRESS = "hub@example.org";
    process.env.EMAIL_PROVIDER_API_URL = "https://mail.example.test/send";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendProductionEmail({ to: "member@example.org", subject: "Hello", text: "Body", idempotencyKey: "notification:1" })).resolves.toBe("email-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://mail.example.test/send",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer re_test", "Idempotency-Key": "notification:1" }),
        body: JSON.stringify({ from: "hub@example.org", to: ["member@example.org"], subject: "Hello", text: "Body" }),
      }),
    );
  });
});
