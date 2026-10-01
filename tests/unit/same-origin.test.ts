import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSameOriginRequest } from "@/lib/same-origin";

/**
 * Route handlers that act on the session cookie must only answer the Hub's
 * own pages (cross-site request forgery). Server Actions get this from
 * Next.js; these routes get it from `isSameOriginRequest`.
 */

const post = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });
const LOCAL = "http://127.0.0.1:3000/api/objects/bulk-edit";

describe("isSameOriginRequest", () => {
  it("accepts a request the browser marks as coming from this site", () => {
    expect(isSameOriginRequest(post(LOCAL, { "sec-fetch-site": "same-origin", host: "127.0.0.1:3000" }))).toBe(true);
  });

  it("accepts a navigation the person started themselves", () => {
    expect(isSameOriginRequest(post(LOCAL, { "sec-fetch-site": "none" }))).toBe(true);
  });

  it("refuses a cross-site request whatever its Origin claims", () => {
    expect(
      isSameOriginRequest(post(LOCAL, { "sec-fetch-site": "cross-site", origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" })),
    ).toBe(false);
  });

  it("refuses a request from another site under the same domain", () => {
    expect(isSameOriginRequest(post(LOCAL, { "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("without Sec-Fetch-Site, compares Origin with the host the browser used", () => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://localhost:3000", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { origin: "https://evil.example", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("behind a proxy, the public host is the one that counts", () => {
    const headers = { host: "10.0.0.7:3000", "x-forwarded-host": "hub.qbbe.ca", "x-forwarded-proto": "https" };
    expect(isSameOriginRequest(post("http://10.0.0.7:3000/auth/sign-out", { ...headers, origin: "https://hub.qbbe.ca" }))).toBe(true);
    expect(isSameOriginRequest(post("http://10.0.0.7:3000/auth/sign-out", { ...headers, origin: "https://HUB.qbbe.ca" }))).toBe(true);
    expect(isSameOriginRequest(post("http://10.0.0.7:3000/auth/sign-out", { ...headers, origin: "http://hub.qbbe.ca" }))).toBe(false);
  });

  it("refuses an opaque origin (a sandboxed frame or a redirect from elsewhere)", () => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "null", host: "127.0.0.1:3000" }))).toBe(false);
  });

  it("lets a request with no browser headers through: no session cookie travels with it", () => {
    expect(isSameOriginRequest(post(LOCAL, {}))).toBe(true);
  });
});

const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

const getSessionContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ getSessionContext }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => true }));
vi.mock("@/features/objects/actions/server", () => ({
  createRequestActionRegistry: async () => {
    throw new Error("not reached");
  },
  statusForActionFailure: () => 422,
}));

beforeEach(() => {
  signOut.mockClear();
  getSessionContext.mockReset();
});

describe("POST /auth/sign-out", () => {
  it("refuses a sign-out posted from another site and keeps the session", async () => {
    const { POST } = await import("@/app/auth/sign-out/route");
    const response = await POST(
      post("http://127.0.0.1:3000/auth/sign-out", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signs out from the Hub's own page and lands on sign-in on the host the browser used", async () => {
    const { POST } = await import("@/app/auth/sign-out/route");
    const response = await POST(
      post("http://localhost:3000/auth/sign-out", { "sec-fetch-site": "same-origin", host: "127.0.0.1:3000" }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3000/sign-in");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/objects/bulk-edit and …/undo", () => {
  it("refuse a cross-site request before looking at the session", async () => {
    const bulk = await import("@/app/api/objects/bulk-edit/route");
    const undo = await import("@/app/api/objects/change-sets/[id]/undo/route");
    const headers = { "sec-fetch-site": "cross-site", origin: "https://evil.example", "content-type": "application/json" };
    const bulkResponse = await bulk.POST(new Request(LOCAL, { method: "POST", headers, body: "{}" }));
    const undoResponse = await undo.POST(
      post("http://127.0.0.1:3000/api/objects/change-sets/00000000-0000-4000-8000-000000000000/undo", headers),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    );
    expect(bulkResponse.status).toBe(403);
    expect(undoResponse.status).toBe(403);
    expect(await bulkResponse.json()).toEqual({ error: "cross_site" });
    expect(getSessionContext).not.toHaveBeenCalled();
  });

  it("still ask who is signed in for a request from the Hub's own page", async () => {
    getSessionContext.mockResolvedValue(null);
    const bulk = await import("@/app/api/objects/bulk-edit/route");
    const response = await bulk.POST(
      new Request(LOCAL, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: "{}" }),
    );
    expect(response.status).toBe(401);
    expect(getSessionContext).toHaveBeenCalledTimes(1);
  });
});
