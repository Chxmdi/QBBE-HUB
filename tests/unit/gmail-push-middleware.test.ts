import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

describe("service-authenticated routes", () => {
  it("lets Gmail push reach its OIDC verifier without a browser session", async () => {
    const result = await updateSession(new NextRequest("https://hub.example/api/integrations/gmail/push"));
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.get("x-middleware-next")).toBe("1");
  });
  it("lets the signed email-provider webhook reach its own verifier", async () => {
    const result = await updateSession(new NextRequest("https://hub.example/api/integrations/email/webhook"));
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.get("x-middleware-next")).toBe("1");
  });
  it("does not exempt unrelated integration paths", async () => {
    const result = await updateSession(new NextRequest("https://hub.example/api/integrations/google/start"));
    expect(result.headers.get("location")).toContain("/sign-in");
  });
});
