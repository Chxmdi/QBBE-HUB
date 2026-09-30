import { afterEach, describe, expect, it, vi } from "vitest";
import { searchConnectedApps } from "@/features/google-objects/search/connected-search.server";
import { cleanTerm, driveQuery, gmailQuery, safeGoogleHref } from "@/features/google-objects/search/google-search";
import { asClient, FakeSupabase } from "../support/fake-supabase";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const now = new Date("2027-03-01T15:00:00Z");
const future = "2027-03-01T17:00:00Z";

function world() {
  const db = new FakeSupabase();
  db.seed("integration_connection", [
    { id: "c-me-drive", organization_id: "o1", user_id: "me", provider: "google_drive", status: "connected" },
    { id: "c-me-gmail", organization_id: "o1", user_id: "me", provider: "gmail", status: "connected" },
    { id: "c-other-drive", organization_id: "o1", user_id: "other", provider: "google_drive", status: "connected" },
    { id: "c-org-drive", organization_id: "o1", user_id: null, provider: "google_drive", status: "connected" },
  ]);
  db.seed("integration_secret", [
    { connection_id: "c-me-drive", access_token: "me-drive-token", refresh_token: null, token_expires_at: future },
    { connection_id: "c-me-gmail", access_token: "me-gmail-token", refresh_token: null, token_expires_at: future },
    { connection_id: "c-other-drive", access_token: "other-token", refresh_token: null, token_expires_at: future },
    { connection_id: "c-org-drive", access_token: "org-token", refresh_token: null, token_expires_at: future },
  ]);
  return db;
}

describe("query building", () => {
  it("bounds the term and needs two characters", () => {
    expect(cleanTerm("  a ")).toBeNull();
    expect(cleanTerm("  board   minutes ")).toBe("board minutes");
    expect(cleanTerm("x".repeat(300))).toHaveLength(100);
  });

  it("escapes Drive quotes and keeps Gmail operators out", () => {
    expect(driveQuery("O'Brien \\ notes")).toBe("name contains 'O\\'Brien \\\\ notes' and trashed = false");
    expect(gmailQuery('budget" from:ceo@example.com')).toBe('"budget  from:ceo@example.com"');
  });

  it("links only to Google's own https hosts", () => {
    expect(safeGoogleHref("https://docs.google.com/document/d/1/edit", "fb")).toBe("https://docs.google.com/document/d/1/edit");
    expect(safeGoogleHref("javascript:alert(1)", "fb")).toBe("fb");
    expect(safeGoogleHref("https://google.com.evil.example/x", "fb")).toBe("fb");
  });
});

describe("searchConnectedApps", () => {
  it("searches with the person's own tokens only, and maps Drive and Gmail results", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
        expect(auth).toBe("Bearer me-drive-token");
        return json({ files: [{ id: "f1", name: "Budget 2027", mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: "https://docs.google.com/spreadsheets/d/f1/edit", modifiedTime: "2027-02-01T00:00:00Z" }] });
      }
      expect(auth).toBe("Bearer me-gmail-token");
      if (url.includes("/messages?")) return json({ messages: [{ id: "m1" }] });
      return json({ snippet: "x", internalDate: "1801526400000", payload: { headers: [{ name: "Subject", value: "Budget question" }, { name: "From", value: "ceo@example.com" }] } });
    });
    const outcomes = await searchConnectedApps({ service: asClient(world()), userId: "me", organizationId: "o1", term: "budget", now, fetchImpl: fetchMock as typeof fetch });
    expect(outcomes).toEqual([
      { source: "drive", status: "ok", results: [expect.objectContaining({ id: "f1", title: "Budget 2027", href: "https://docs.google.com/spreadsheets/d/f1/edit" })] },
      { source: "gmail", status: "ok", results: [expect.objectContaining({ id: "m1", title: "Budget question", detail: "ceo@example.com" })] },
    ]);
    const tokens = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"));
    expect(tokens).not.toContain("Bearer other-token");
    expect(tokens).not.toContain("Bearer org-token");
  });

  it("never falls back to someone else's or the organization's connection", async () => {
    const fetchMock = vi.fn();
    const outcomes = await searchConnectedApps({ service: asClient(world()), userId: "nobody", organizationId: "o1", term: "budget", now, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(outcomes).toEqual([
      { source: "drive", status: "not_connected" },
      { source: "gmail", status: "not_connected" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps one service's failure from hiding the other", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) =>
      String(input).includes("drive") ? json({ error: "quota" }, 403) : json({ messages: [] }),
    );
    const outcomes = await searchConnectedApps({ service: asClient(world()), userId: "me", organizationId: "o1", term: "budget", now, fetchImpl: fetchMock as typeof fetch });
    expect(outcomes).toEqual([
      { source: "drive", status: "unavailable" },
      { source: "gmail", status: "ok", results: [] },
    ]);
  });

  it("refreshes an expired token with the person's own refresh token", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const db = world();
    db.seed("integration_secret", [
      { connection_id: "c-me-drive", access_token: "stale", refresh_token: "me-refresh", token_expires_at: "2027-03-01T14:00:00Z" },
    ]);
    const tokenFetch = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      return json({ access_token: "fresh", expires_in: 3600 });
    });
    vi.stubGlobal("fetch", tokenFetch);
    const searchFetch = vi.fn(async () => json({ files: [] }));
    const outcomes = await searchConnectedApps({ service: asClient(db), userId: "me", organizationId: "o1", term: "budget", now, fetchImpl: searchFetch as unknown as typeof fetch });
    expect(outcomes[0]).toEqual({ source: "drive", status: "ok", results: [] });
    expect(db.rows("integration_secret").find((r) => r.connection_id === "c-me-drive")?.access_token).toBe("fresh");
    vi.unstubAllEnvs();
  });
});
