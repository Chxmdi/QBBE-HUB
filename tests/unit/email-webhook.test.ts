import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../support/fake-supabase";
import {
  parseResendEvent,
  resendSignatureIsValid,
} from "@/features/notifications/services/email-webhook";

let db: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => db,
}));
const { POST } = await import("@/app/api/integrations/email/webhook/route");

const KEY = Buffer.from("resend-webhook-test-key-32-bytes!!");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = Math.floor(Date.now() / 1000);

function sign(body: string, id = "msg_1", timestamp = String(NOW), key = KEY) {
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { id, timestamp, signature: `v1,${signature}` };
}

function request(body: string, headers = sign(body)) {
  return new Request("https://hub.example/api/integrations/email/webhook", {
    method: "POST",
    body,
    headers: {
      "svix-id": headers.id,
      "svix-timestamp": headers.timestamp,
      "svix-signature": headers.signature,
    },
  });
}

const bounced = (bounceType = "Permanent") => JSON.stringify({
  type: "email.bounced",
  data: {
    email_id: "provider-1",
    to: ["Gone@Example.org"],
    bounce: { type: bounceType, message: "Mailbox does not exist" },
  },
});

describe("Resend webhook signatures", () => {
  it("accepts a correctly signed, fresh event", () => {
    expect(resendSignatureIsValid("{}", sign("{}"), SECRET, NOW)).toBe(true);
  });

  it("accepts it when one of several rotated signatures matches", () => {
    const good = sign("{}");
    expect(resendSignatureIsValid("{}", { ...good, signature: `v1,AAAA ${good.signature}` }, SECRET, NOW)).toBe(true);
  });

  it.each([
    ["a tampered body", (h: ReturnType<typeof sign>) => ({ body: '{"x":1}', headers: h })],
    ["a signature from another key", () => ({ body: "{}", headers: sign("{}", "msg_1", String(NOW), Buffer.from("another-key")) })],
    ["a replayed old event", () => ({ body: "{}", headers: sign("{}", "msg_1", String(NOW - 600)) })],
    ["a missing signature", (h: ReturnType<typeof sign>) => ({ body: "{}", headers: { ...h, signature: null } })],
    ["an unknown signature version", (h: ReturnType<typeof sign>) => ({ body: "{}", headers: { ...h, signature: h.signature.replace("v1,", "v2,") } })],
  ])("rejects %s", (_label, make) => {
    const { body, headers } = make(sign("{}"));
    expect(resendSignatureIsValid(body, headers as never, SECRET, NOW)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    expect(resendSignatureIsValid("{}", sign("{}"), undefined, NOW)).toBe(false);
  });
});

describe("Resend event parsing", () => {
  it("treats a bounce with no type as permanent, and a transient one as recoverable", () => {
    expect(parseResendEvent({ type: "email.bounced", data: { to: "a@b.org" } })).toMatchObject({ permanent: true });
    expect(parseResendEvent(JSON.parse(bounced("Transient")))).toMatchObject({ permanent: false });
  });

  it("ignores events the Hub does not act on", () => {
    expect(parseResendEvent({ type: "email.delivered", data: {} })).toEqual({ kind: "ignored" });
    expect(parseResendEvent(null)).toEqual({ kind: "ignored" });
  });
});

describe("POST /api/integrations/email/webhook", () => {
  beforeEach(() => {
    db = new FakeSupabase();
    db.seed("email_delivery", [{ id: "d1", recipient: "gone@example.org", status: "sent", provider_message_id: "provider-1" }]);
    db.seed("email_suppression", []);
    vi.stubEnv("EMAIL_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records a hard bounce on the delivery and suppresses the address", async () => {
    const response = await POST(request(bounced()));

    expect(response.status).toBe(200);
    expect(db.rows("email_delivery")[0]).toMatchObject({ status: "bounced" });
    expect(String(db.rows("email_delivery")[0].last_error)).toContain("Mailbox does not exist");
    expect(db.rows("email_suppression")).toEqual([
      expect.objectContaining({ address: "gone@example.org", reason: "bounced" }),
    ]);
  });

  it("suppresses the address of somebody who reported spam", async () => {
    const body = JSON.stringify({ type: "email.complained", data: { email_id: "provider-1", to: ["gone@example.org"] } });
    await POST(request(body));
    expect(db.rows("email_suppression")).toEqual([
      expect.objectContaining({ address: "gone@example.org", reason: "complained" }),
    ]);
  });

  it("records a transient bounce without giving up on the address", async () => {
    await POST(request(bounced("Transient")));
    expect(db.rows("email_delivery")[0]).toMatchObject({ status: "bounced" });
    expect(db.rows("email_suppression")).toHaveLength(0);
  });

  it("changes nothing for an unsigned or forged request", async () => {
    const body = bounced();
    const response = await POST(request(body, { ...sign(body), signature: "v1,Zm9yZ2Vk" }));

    expect(response.status).toBe(401);
    expect(db.rows("email_delivery")[0]).toMatchObject({ status: "sent" });
    expect(db.rows("email_suppression")).toHaveLength(0);
  });

  it("refuses to run unconfigured rather than accept anything", async () => {
    vi.stubEnv("EMAIL_WEBHOOK_SECRET", "");
    const response = await POST(request(bounced()));
    expect(response.status).toBe(503);
    expect(db.rows("email_suppression")).toHaveLength(0);
  });

  it("asks the provider to redeliver when the database refuses the write", async () => {
    db.fail((op) => op.kind === "update" && op.name === "email_delivery");
    const response = await POST(request(bounced()));
    expect(response.status).toBe(500);
  });
});
