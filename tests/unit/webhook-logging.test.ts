import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every refused webhook or job call writes exactly one structured line and
 * counts it, so a rotated secret or a forgery attempt is visible.
 */
const hits = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (_name: string, args: { p_bucket: string }) => {
      hits.push(args.p_bucket);
      return { data: [{ allowed: true, used: 1, reset_at: new Date().toISOString() }], error: null };
    },
  }),
}));

const zeffy = await import("@/app/api/integrations/zeffy/webhook/route");
const email = await import("@/app/api/integrations/email/webhook/route");
const gmail = await import("@/app/api/integrations/gmail/push/route");
const jobs = await import("@/app/api/jobs/[job]/route");

const post = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: "{}", headers: { "x-request-id": "req-abcdef12", ...headers } });

describe("refused webhook and job calls", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    hits.length = 0;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const logged = () => [...warn.mock.calls, ...error.mock.calls].map((c) => JSON.parse(String(c[0])));

  it("logs and counts an unconfigured Zeffy webhook", async () => {
    vi.stubEnv("ZEFFY_WEBHOOK_SECRET", "");
    const response = await zeffy.POST(post("https://hub.example/api/integrations/zeffy/webhook"));
    expect(response.status).toBe(503);
    expect(logged()).toEqual([expect.objectContaining({ event: "zeffy_webhook.refused", reason: "not_configured", status: 503, requestId: "req-abcdef12" })]);
    expect(hits).toEqual(["webhook-refused:zeffy_webhook:not_configured"]);
  });

  it("logs and counts a bad Zeffy signature", async () => {
    vi.stubEnv("ZEFFY_WEBHOOK_SECRET", "x".repeat(32));
    const response = await zeffy.POST(post("https://hub.example/api/integrations/zeffy/webhook", { "zeffy-signature": "bad" }));
    expect(response.status).toBe(401);
    expect(logged()).toEqual([expect.objectContaining({ event: "zeffy_webhook.refused", reason: "signature_invalid" })]);
    expect(hits).toEqual(["webhook-refused:zeffy_webhook:signature_invalid"]);
  });

  it("logs and counts a bad email webhook signature", async () => {
    vi.stubEnv("EMAIL_WEBHOOK_SECRET", `whsec_${Buffer.from("k".repeat(32)).toString("base64")}`);
    const response = await email.POST(post("https://hub.example/api/integrations/email/webhook"));
    expect(response.status).toBe(401);
    expect(logged()).toEqual([expect.objectContaining({ event: "email_webhook.refused", reason: "signature_invalid" })]);
    expect(hits).toEqual(["webhook-refused:email_webhook:signature_invalid"]);
  });

  it("logs and counts an unauthenticated Gmail push", async () => {
    const response = await gmail.POST(post("https://hub.example/api/integrations/gmail/push"));
    expect(response.status).toBe(401);
    expect(logged()).toEqual([expect.objectContaining({ event: "gmail_push.refused", reason: "unauthorized" })]);
    expect(hits).toEqual(["webhook-refused:gmail_push:unauthorized"]);
  });

  it("logs and counts a job call with the wrong secret, without the secret", async () => {
    vi.stubEnv("CRON_JOB_SECRET", "y".repeat(40));
    const response = await jobs.POST(post("https://hub.example/api/jobs/scan-documents", { "x-job-secret": "wrong-secret-value" }), {
      params: Promise.resolve({ job: "scan-documents" }),
    });
    expect(response.status).toBe(403);
    expect(logged()).toEqual([expect.objectContaining({ event: "job_route.refused", reason: "unauthorized", status: 403 })]);
    expect(JSON.stringify(logged())).not.toContain("wrong-secret-value");
    expect(hits).toEqual(["webhook-refused:job_route:unauthorized"]);
  });
});
