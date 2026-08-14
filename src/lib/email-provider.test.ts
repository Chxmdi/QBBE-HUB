import { describe, expect, it } from "vitest";
import { localMailpitEnabled, transactionalEmailIsLive } from "@/lib/email-provider";

describe("email provider honesty", () => {
  it("does not claim a live production mail client", () => {
    expect(transactionalEmailIsLive()).toBe(false);
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
});
