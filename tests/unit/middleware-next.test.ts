import { describe, expect, it } from "vitest";
import { mfaPath, returnPath, signInUrl } from "@/lib/return-path";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("where a person returns after signing in or verifying", () => {
  it("keeps the query string of the link they opened", () => {
    const url = new URL("http://127.0.0.1:3000/my-work?task=abc");
    expect(returnPath(url)).toBe("/my-work?task=abc");
    const target = signInUrl(url);
    expect(target.pathname).toBe("/sign-in");
    // Only `next`: the link's own parameters do not leak onto the sign-in page.
    expect([...target.searchParams.keys()]).toEqual(["next"]);
    expect(target.search).toBe("?next=%2Fmy-work%3Ftask%3Dabc");
    expect(safeRedirectPath(target.searchParams.get("next"))).toBe("/my-work?task=abc");
  });

  it("sends two-step verification back to the page, but never in a loop", () => {
    expect(mfaPath("/channels/x?thread=y")).toBe("/mfa?next=%2Fchannels%2Fx%3Fthread%3Dy");
    expect(mfaPath("/")).toBe("/mfa");
    expect(mfaPath("/mfa?next=%2F")).toBe("/mfa");
    expect(mfaPath(null)).toBe("/mfa");
    expect(mfaPath("https://evil.example/")).toBe("/mfa");
    expect(mfaPath("//evil.example/")).toBe("/mfa");
    expect(mfaPath("/\\evil.example/")).toBe("/mfa");
  });

  it("never turns dot segments into another site", () => {
    for (const value of ["/.//evil.com", "/a/..//evil.com", "/%2e//evil.com", "/%2E%2E//evil.com"]) {
      expect(safeRedirectPath(value), value).toBe("/");
    }
  });
});
