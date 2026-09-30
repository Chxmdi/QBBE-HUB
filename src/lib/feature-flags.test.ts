import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// A real supabase-js client, so the query builder runs for real; only the
// network is replaced. The server client is mocked so nothing reads cookies.
let respond: (url: string) => Response;
let requested: string[] = [];
const fakeClient = () =>
  createClient("https://project.supabase.co", "anon-key", {
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input);
        requested.push(url);
        return respond(url);
      },
    },
  });
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => fakeClient(),
}));
const {
  isEnabled,
  overriddenFlags,
  workspaceOsFlagKeys,
  WORKSPACE_OS_FLAGS_ENV,
} = await import("@/lib/feature-flags");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllEnvs();
  requested = [];
});

describe("overriddenFlags", () => {
  it("is empty when the variable is unset or blank", () => {
    expect(overriddenFlags(undefined).size).toBe(0);
    expect(overriddenFlags("").size).toBe(0);
    expect(overriddenFlags(" , ").size).toBe(0);
  });

  it("turns on only the named Workspace OS switches", () => {
    expect([...overriddenFlags(" wos_objects,WOS_LENSES ")].sort()).toEqual([
      "wos_lenses",
      "wos_objects",
    ]);
  });

  it("turns on every Workspace OS switch for `all`", () => {
    expect([...overriddenFlags("all")].sort()).toEqual([...workspaceOsFlagKeys].sort());
  });

  it("ignores unknown names and switches that are not Workspace OS", () => {
    expect(overriddenFlags("objects,gmail_inbox,workflow_rules").size).toBe(0);
  });
});

describe("isEnabled", () => {
  it("has one switch for each Workspace OS module", () => {
    expect(workspaceOsFlagKeys).toEqual([
      "wos_objects",
      "wos_spaces",
      "wos_pages",
      "wos_editor",
      "wos_lenses",
      "wos_home",
      "wos_capture",
      "wos_workflows_v2",
      "wos_forms_v2",
      "wos_public_pages",
      "wos_offline",
    ]);
  });

  it("reads the switch's row through the caller's session", async () => {
    respond = () => json({ enabled: true });
    expect(await isEnabled("wos_objects")).toBe(true);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/rest/v1/feature_flag");
    expect(requested[0]).toContain("key=eq.wos_objects");
  });

  it("is off when the row says so", async () => {
    respond = () => json({ enabled: false });
    expect(await isEnabled("wos_objects", fakeClient())).toBe(false);
  });

  it("is off when the row is missing or hidden by RLS", async () => {
    respond = () => json(null);
    expect(await isEnabled("wos_spaces", fakeClient())).toBe(false);
  });

  it("fails closed on a database error", async () => {
    respond = () => json({ message: "permission denied", code: "42501" }, 403);
    expect(await isEnabled("wos_home", fakeClient())).toBe(false);
  });

  it("lets the staging override turn a switch on without reading the table", async () => {
    vi.stubEnv(WORKSPACE_OS_FLAGS_ENV, "wos_home");
    respond = () => json({ enabled: false });
    expect(await isEnabled("wos_home", fakeClient())).toBe(true);
    expect(requested).toHaveLength(0);
  });

  it("never lets the override turn on a switch outside Workspace OS", async () => {
    vi.stubEnv(WORKSPACE_OS_FLAGS_ENV, "all,gmail_inbox");
    respond = () => json({ enabled: false });
    expect(await isEnabled("gmail_inbox", fakeClient())).toBe(false);
  });
});
