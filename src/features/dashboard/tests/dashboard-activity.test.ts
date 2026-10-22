import { beforeEach, describe, expect, it, vi } from "vitest";

// PERF-001: Home's "recent activity" list must be scoped to the viewer's
// organization, so the database reads it newest-first from the
// (organization_id, created_at desc) index and stops after ten rows, instead
// of checking every activity row in the table.

type Call = { method: string; args: unknown[] };
const queries: { table: string; calls: Call[] }[] = [];

function chain(table: string) {
  const entry = { table, calls: [] as Call[] };
  queries.push(entry);
  const result = { data: [], count: 0, error: null };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => unknown) => resolve(result);
        }
        return (...args: unknown[]) => {
          entry.calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

vi.mock("@/lib/supabase/page", () => ({
  createSupabasePageClient: vi.fn(async () => ({
    from: (table: string) => chain(table),
    rpc: (name: string) => chain(`rpc:${name}`),
  })),
}));

vi.mock("@/lib/i18n/server", () => ({
  getT: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "en"),
}));

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({
    userId: "user-1",
    organizationId: "org-1",
    timeZone: "America/Toronto",
  })),
}));

describe("getDashboardData recent activity", () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it("reads activity only from the viewer's organization, newest first, ten rows", async () => {
    const { getDashboardData } = await import("../services/dashboard.queries");
    await getDashboardData("user-1", "America/Toronto");

    const activity = queries.filter((query) => query.table === "activity_event");
    expect(activity).toHaveLength(1);
    const calls = activity[0].calls;
    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "org-1"] });
    expect(calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
    expect(calls).toContainEqual({ method: "limit", args: [10] });
  });
});
