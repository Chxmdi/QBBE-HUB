import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, authenticate } from "../services/api-handler";
import { decodeCursor, encodeCursor } from "../services/objects";
import { apiTokensEn } from "../i18n/api-tokens.en";
import { apiTokensFrCA } from "../i18n/api-tokens.fr-CA";
import { apiDocs } from "../i18n/docs";
import { apiScopes, bearerToken, generateToken, hashToken } from "../token";

describe("tokens", () => {
  it("are long, random, prefixed and stored only as a SHA-256 hash", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).toMatch(/^qbbe_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(a.prefix).toBe(a.token.slice(0, 12));
    expect(hashToken(a.token)).toBe(a.hash);
  });

  it("are read only from a well-formed bearer header", () => {
    const { token } = generateToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer ${token}`)).toBeNull();
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken("Bearer qbbe_short")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

/** Just enough of the query builder for `authenticate`. */
function fakeDb(token: Record<string, unknown> | null, member: boolean) {
  const updates: unknown[] = [];
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: table === "api_token" ? token : member ? { user_id: "u" } : null }),
      update: (patch: unknown) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

describe("authenticate", () => {
  const { token } = generateToken();
  const now = new Date("2026-11-06T12:00:00.000Z");
  const row = { id: "t", user_id: "u", organization_id: "o", scopes: ["objects:read"], expires_at: "2027-01-01T00:00:00.000Z", revoked_at: null };
  const refusal = async (promise: Promise<unknown>) => promise.then(() => null, (error: ApiError) => [error.status, error.code]);

  it("accepts a live token of an active member and records its use", async () => {
    const { db, updates } = fakeDb(row, true);
    await expect(authenticate(db, `Bearer ${token}`, now)).resolves.toEqual({
      tokenId: "t", userId: "u", organizationId: "o", scopes: ["objects:read"],
    });
    expect(updates).toEqual([{ last_used_at: now.toISOString() }]);
  });

  it("refuses a missing, unknown, revoked or expired token, or a departed member", async () => {
    expect(await refusal(authenticate(fakeDb(row, true).db, null, now))).toEqual([401, "unauthenticated"]);
    expect(await refusal(authenticate(fakeDb(null, true).db, `Bearer ${token}`, now))).toEqual([401, "invalid_token"]);
    expect(await refusal(authenticate(fakeDb({ ...row, revoked_at: "2026-01-01" }, true).db, `Bearer ${token}`, now))).toEqual([401, "invalid_token"]);
    expect(await refusal(authenticate(fakeDb({ ...row, expires_at: "2026-11-06T12:00:00.000Z" }, true).db, `Bearer ${token}`, now))).toEqual([401, "invalid_token"]);
    expect(await refusal(authenticate(fakeDb(row, false).db, `Bearer ${token}`, now))).toEqual([401, "invalid_token"]);
  });
});

describe("cursors", () => {
  it("round-trip and reject anything else", () => {
    const row = { updated_at: "2026-11-06T12:00:00.000Z", id: "11111111-1111-4111-8111-111111111111" };
    expect(decodeCursor(encodeCursor(row))).toEqual({ updatedAt: row.updated_at, id: row.id });
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor("nonsense")).toThrow(ApiError);
    expect(() => decodeCursor(Buffer.from('["x","y"]').toString("base64url"))).toThrow(ApiError);
  });
});

describe("dictionaries and docs", () => {
  const leaves = (value: unknown, prefix = ""): string[] =>
    typeof value === "string" ? [prefix] : Object.entries(value as object).flatMap(([key, child]) => leaves(child, `${prefix}/${key}`));

  it("have every English string in French", () => {
    expect(leaves(apiTokensFrCA).sort()).toEqual(leaves(apiTokensEn).sort());
    for (const scope of apiScopes) expect(apiTokensFrCA.scopes[scope]).toBeTruthy();
  });

  it("document the same endpoints and sections in both languages", () => {
    const en = apiDocs("en");
    const fr = apiDocs("fr-CA");
    expect(fr.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual(en.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    expect(fr.sections.map((section) => section.id)).toEqual(en.sections.map((section) => section.id));
  });
});
