import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ enabled: false, session: 0, client: 0, rpc: [] as unknown[] }));

vi.mock("@/lib/feature-flags", () => ({ isEnabled: vi.fn(async () => calls.enabled) }));
vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => {
    calls.session += 1;
    return { userId: "u", organizationId: "o", timeZone: "America/Toronto" };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => {
    calls.client += 1;
    return {
      rpc: async (fn: string, args: unknown) => {
        calls.rpc.push({ fn, args });
        if (fn === "lens_catalog") return { data: null, error: null };
        return { data: { type: "task", measures: [], totals: { m0: 2 }, groupBy: "status", groups: [] }, error: null };
      },
    };
  }),
}));
vi.mock("@/lib/query/run", async (original) => ({
  ...(await original<typeof import("@/lib/query/run")>()),
  loadCatalog: vi.fn(async () => ({
    task: {
      key: "task",
      name: { en: "Task", fr: "Tâche" },
      properties: [
        { key: "status", kind: "select", propertyKind: "select", name: { en: "Status", fr: "Statut" }, groupable: true, sortable: true },
        { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate", fr: "Estimation" }, groupable: false, sortable: true },
        { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, groupable: false, sortable: true },
      ],
    },
  })),
}));
vi.mock("@/features/lenses/services/lens-store.queries", () => ({ getLens: vi.fn(async () => null) }));

import { runChartBlock } from "./d3-chart.actions";

const props = { version: 2, source: { type: "task" }, layout: "chart", where: [{ path: "title", op: "starts_with", value: "x" }], pageFilters: { enabled: true, paths: ["status"] } };

describe("the chart action", () => {
  beforeEach(() => {
    calls.enabled = false;
    calls.session = 0;
    calls.client = 0;
    calls.rpc = [];
  });

  it("refuses everything while wos_lenses is off, before reading the session or the database [switch off]", async () => {
    expect(await runChartBlock(props, [])).toEqual({ ok: false, reason: "off" });
    expect(calls).toMatchObject({ session: 0, client: 0, rpc: [] });
  });

  it("totals the view's spec with lens_aggregate, as the reader, keeping only allowed page filters", async () => {
    calls.enabled = true;
    const run = await runChartBlock({ ...props, chart: { kind: "pie", total: "sum", property: "estimate" } }, [
      { path: "status", op: "is", value: "ready" },
      { path: "title", op: "contains", value: "not allowed" },
    ]);
    expect(run).toMatchObject({ ok: true, result: { totals: { m0: 2 } } });
    expect(calls.session).toBe(1);
    expect(calls.rpc).toEqual([
      {
        fn: "lens_aggregate",
        args: {
          spec: {
            version: 1,
            type: "task",
            where: { and: [{ property: "title", operator: "starts_with", value: "x" }, { property: "status", operator: "is", value: "ready" }] },
            groupBy: { property: "status" },
          },
          measures: [{ fn: "sum", property: "estimate" }],
          time_zone: "America/Toronto",
        },
      },
    ]);
  });

  it("refuses bad input without asking the database for totals", async () => {
    calls.enabled = true;
    expect(await runChartBlock({ ...props, layout: "table" }, [])).toEqual({ ok: false, reason: "invalid" });
    expect(await runChartBlock({ ...props, chart: { kind: "bar", total: "sum" } }, [])).toEqual({ ok: false, reason: "invalid" });
    expect(await runChartBlock({ ...props, chart: { kind: "bar", total: "sum", property: "title" } }, [])).toEqual({ ok: false, reason: "invalid" });
    expect(await runChartBlock(props, "not a list")).toEqual({ ok: false, reason: "invalid" });
    expect(await runChartBlock({ ...props, source: { lensId: "11111111-1111-4111-8111-111111111111" } }, [])).toEqual({ ok: false, reason: "missing" });
    expect(calls.rpc).toEqual([]);
  });
});
