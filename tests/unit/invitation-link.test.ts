import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvitationSecret,
  hashInvitationToken,
  invitationLink,
} from "@/features/admin/services/invitation-link";

/**
 * The invitation secret (SEC-001). The database checks a sign-up's token by
 * hashing it with `encode(digest(token, 'sha256'), 'hex')`; these assertions
 * pin the Node side to the same digest, so the two can never disagree.
 */
describe("invitation link", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("makes a 256-bit, URL-safe token and stores only its SHA-256", () => {
    const { token, tokenHash } = createInvitationSecret();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(tokenHash).not.toContain(token);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createInvitationSecret().token));
    expect(tokens.size).toBe(200);
  });

  it("hashes the way Postgres does", () => {
    // Recorded from: select encode(extensions.digest(
    //   'right-token-0123456789abcdefghijklmnopqr', 'sha256'), 'hex');
    expect(hashInvitationToken("right-token-0123456789abcdefghijklmnopqr")).toBe(
      "cc393bc47e0680462e364317fc923b3311eeb0e5c609157e412c1e436404c5ba",
    );
  });

  it("links to the sign-up page on the Hub's own address", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://hub.example.org/");
    expect(invitationLink("abc_DEF-123")).toBe("https://hub.example.org/sign-up?invite=abc_DEF-123");
  });
});
