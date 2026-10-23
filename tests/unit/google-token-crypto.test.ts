import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GoogleTokenKeyError,
  isSealed,
  needsResealing,
  openToken,
  sealToken,
  tokenKeyProblem,
} from "@/features/inbox/services/google-token-crypto";
import { serverEnvProblems } from "@/lib/env";

/**
 * Google tokens are encrypted before they reach the database, with a key the
 * server holds in GOOGLE_TOKEN_KEY (PRIV-011). A stored value tells which key
 * sealed it, so the key can be rotated, and is bound to its connection, so a
 * value copied onto another connection does not open.
 */

const CONNECTION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const key = () => randomBytes(32).toString("base64");
const saved = { current: process.env.GOOGLE_TOKEN_KEY, previous: process.env.GOOGLE_TOKEN_KEY_PREVIOUS };

beforeEach(() => {
  process.env.GOOGLE_TOKEN_KEY = key();
  delete process.env.GOOGLE_TOKEN_KEY_PREVIOUS;
});
afterEach(() => {
  process.env.GOOGLE_TOKEN_KEY = saved.current;
  process.env.GOOGLE_TOKEN_KEY_PREVIOUS = saved.previous;
});

describe("Google token encryption", () => {
  it("seals a token so the stored value holds none of it, and opens it again", () => {
    const sealed = sealToken("ya29.secret-access-token", CONNECTION);
    expect(sealed).toMatch(/^enc:v1:[0-9a-f]{8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("secret-access-token");
    expect(isSealed(sealed)).toBe(true);
    expect(openToken(sealed, CONNECTION)).toBe("ya29.secret-access-token");
    expect(sealToken("ya29.secret-access-token", CONNECTION)).not.toBe(sealed);
  });

  it("refuses a shortened authentication tag", () => {
    const parts = sealToken("refresh-token", CONNECTION).split(":");
    parts[4] = Buffer.from(parts[4], "base64url").subarray(0, 4).toString("base64url");
    expect(() => openToken(parts.join(":"), CONNECTION)).toThrow();
  });

  it("refuses a value moved to another connection, or altered", () => {
    const sealed = sealToken("refresh-token", CONNECTION);
    expect(() => openToken(sealed, OTHER)).toThrow();
    const parts = sealed.split(":");
    parts[5] = parts[5].startsWith("A") ? `B${parts[5].slice(1)}` : `A${parts[5].slice(1)}`;
    expect(() => openToken(parts.join(":"), CONNECTION)).toThrow();
  });

  it("opens values sealed with the previous key during a rotation, and says they need resealing", () => {
    const old = process.env.GOOGLE_TOKEN_KEY!;
    const sealed = sealToken("refresh-token", CONNECTION);
    process.env.GOOGLE_TOKEN_KEY = key();
    expect(() => openToken(sealed, CONNECTION)).toThrow(GoogleTokenKeyError);
    process.env.GOOGLE_TOKEN_KEY_PREVIOUS = old;
    expect(openToken(sealed, CONNECTION)).toBe("refresh-token");
    expect(needsResealing(sealed)).toBe(true);
    expect(needsResealing(sealToken("refresh-token", CONNECTION))).toBe(false);
  });

  it("reads a token stored before encryption as it is, and says it needs sealing", () => {
    expect(openToken("legacy-plain-token", CONNECTION)).toBe("legacy-plain-token");
    expect(isSealed("legacy-plain-token")).toBe(false);
    expect(needsResealing("legacy-plain-token")).toBe(true);
    expect(openToken(null, CONNECTION)).toBeNull();
  });

  it("will not seal without a valid key", () => {
    delete process.env.GOOGLE_TOKEN_KEY;
    expect(() => sealToken("x", CONNECTION)).toThrow(GoogleTokenKeyError);
    process.env.GOOGLE_TOKEN_KEY = "too-short";
    expect(() => sealToken("x", CONNECTION)).toThrow(GoogleTokenKeyError);
    // Node's decoder skips stray characters; the key's shape is checked first.
    process.env.GOOGLE_TOKEN_KEY = `!!${randomBytes(32).toString("base64")}!!`;
    expect(() => sealToken("x", CONNECTION)).toThrow(GoogleTokenKeyError);
  });

  it("makes a deployed server refuse to start without a valid key, naming the setting and never a value", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "a",
      SUPABASE_SERVICE_ROLE_KEY: "b",
      CRON_JOB_SECRET: "x".repeat(40),
      NEXT_PUBLIC_APP_URL: "https://hub.example.org",
      QBBE_ENV: "production",
    };
    expect(serverEnvProblems(env)).toContain("GOOGLE_TOKEN_KEY is missing or is not 32 bytes in base64.");
    const good = key();
    expect(serverEnvProblems({ ...env, GOOGLE_TOKEN_KEY: good }).join(" ")).not.toContain("GOOGLE_TOKEN_KEY");
    expect(serverEnvProblems({ ...env, GOOGLE_TOKEN_KEY: "short" }).join(" ")).not.toContain("short");
    expect(tokenKeyProblem({ GOOGLE_TOKEN_KEY: good, GOOGLE_TOKEN_KEY_PREVIOUS: "bad" })).toBe(
      "GOOGLE_TOKEN_KEY_PREVIOUS is set but is not 32 bytes in base64.",
    );
  });
});
