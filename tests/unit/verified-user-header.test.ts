import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
  encodeVerifiedUser,
} from "@/lib/verified-user-header";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const FORGED_ID = "99999999-8888-4777-8666-555555555555";
let signedIn: { id: string; email: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: async () => ({ data: { user: signedIn } }) },
  })),
}));

/** The header value the proxy forwards to the app for this request, if any. */
function forwarded(result: Response): string | null {
  return result.headers.get(`x-middleware-request-${VERIFIED_USER_HEADER}`);
}

function forged(path: string): NextRequest {
  return new NextRequest(`https://hub.example${path}`, {
    headers: {
      [VERIFIED_USER_HEADER]: encodeVerifiedUser({ id: FORGED_ID, email: "x@example.com" }),
    },
  });
}

describe("the verified-user header (#115)", () => {
  beforeEach(() => {
    signedIn = null;
  });

  it("carries the user Auth verified, not one the client claimed", async () => {
    signedIn = { id: USER_ID, email: "staff@example.com" };
    const value = forwarded(await updateSession(forged("/board")));
    expect(decodeVerifiedUser(value)).toEqual({ id: USER_ID, email: "staff@example.com" });
  });

  // The proxy forwards exactly the headers named in x-middleware-override-headers;
  // anything missing from that list never reaches the app.
  function forwardsHeader(result: Response): boolean {
    const list = (result.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(result.headers.get("x-middleware-override-headers")).not.toBeNull();
    return list.includes(VERIFIED_USER_HEADER);
  }

  it("is removed when nobody is signed in, even on a public page", async () => {
    expect(forwardsHeader(await updateSession(forged("/sign-in")))).toBe(false);
  });

  it("is removed on the service-authenticated routes that skip Auth", async () => {
    expect(forwardsHeader(await updateSession(forged("/api/jobs/drain-notifications")))).toBe(false);
  });

  it("rejects values that are not a user id", () => {
    expect(decodeVerifiedUser(null)).toBeNull();
    expect(decodeVerifiedUser("not-json")).toBeNull();
    expect(decodeVerifiedUser(encodeURIComponent(JSON.stringify({ id: "admin" })))).toBeNull();
  });
});
