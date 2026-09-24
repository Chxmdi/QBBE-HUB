import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// A real supabase-js client, so this exercises the actual query builders;
// only the network is replaced.
let respond: () => Response;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    createClient("https://project.supabase.co", "anon-key", {
      global: { fetch: async () => respond() },
    }),
}));
const { createSupabasePageClient } = await import("@/lib/supabase/page");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.restoreAllMocks());

describe("the page Supabase client", () => {
  it("returns data as usual when the query succeeds", async () => {
    respond = () => json([{ id: "p1" }]);
    const db = await createSupabasePageClient();
    const { data } = await db.from("project").select("id").eq("archived", false).limit(5);
    expect(data).toEqual([{ id: "p1" }]);
  });

  it("throws on a database error instead of resolving to empty data", async () => {
    respond = () => json({ message: "permission denied for table project", code: "42501" }, 403);
    const db = await createSupabasePageClient();
    await expect(
      db.from("project").select("id").order("created_at").limit(5),
    ).rejects.toMatchObject({ message: "permission denied for table project" });
  });

  it("throws when the database cannot be reached at all", async () => {
    respond = () => {
      throw new TypeError("fetch failed");
    };
    const db = await createSupabasePageClient();
    await expect(db.from("project").select("id")).rejects.toThrow();
    // supabase-js retries a failed fetch with backoff before giving up.
  }, 60_000);

  it("keeps throwing inside Promise.all, the way the pages read", async () => {
    respond = () => json({ message: "canceling statement due to statement timeout" }, 500);
    const db = await createSupabasePageClient();
    await expect(Promise.all([
      db.from("project").select("id"),
      db.from("program").select("id").maybeSingle(),
    ])).rejects.toMatchObject({ message: expect.stringContaining("statement timeout") });
  });

  it("throws from an RPC as well", async () => {
    respond = () => json({ message: "function failed" }, 500);
    const db = await createSupabasePageClient();
    await expect(db.rpc("global_search", { p_query: "x" })).rejects.toMatchObject({ message: "function failed" });
  });

  it("treats no matching row as an empty result, not an error", async () => {
    respond = () => json([]);
    const db = await createSupabasePageClient();
    const { data } = await db.from("project").select("id").eq("id", "x").maybeSingle();
    expect(data).toBeNull();
  });
});
