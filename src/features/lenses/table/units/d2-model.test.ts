import { describe, expect, it } from "vitest";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { parseMeasures } from "@/lib/query/aggregate";
import { parseLensSpec } from "@/lib/query/run";
import {
  aggregateSpecFor,
  allowedTotals,
  applyColumnSettings,
  d2Info,
  groupTotalsRows,
  measuresFor,
  overallTotals,
  totalFor,
  totalsChoicesSchema,
  totalsSaveSchema,
  columnRenameSchema,
} from "./d2-model";
import { d2ColumnItems } from "./d2-totals";
import { withD2Columns } from "@/features/lenses/services/d2-columns.server";
import { defaultColumns, reconcileColumns, stateFromLens, type TableState } from "../model";

const p = (key: string, kind: CatalogProperty["kind"], extra: Partial<CatalogProperty> = {}): CatalogProperty => ({
  key,
  kind,
  propertyKind: kind as CatalogProperty["propertyKind"],
  name: { en: key[0].toUpperCase() + key.slice(1), fr: `fr-${key}` },
  sortable: true,
  groupable: kind === "select",
  ...extra,
});

const type: CatalogType = {
  key: "task",
  name: { en: "Task", fr: "Tâche" },
  properties: [
    p("title", "text"),
    p("status", "select", { choices: [{ key: "ready", label: { en: "Ready", fr: "Prête" } }] }),
    p("assignee", "person", { ref: { table: "user_profile", label: "full_name" } }),
    p("due", "date"),
    p("estimate", "number"),
    p("done", "checkbox"),
    p("review_role", "person", { filterOnly: true }),
  ],
};
const properties = new Map(type.properties.map((x) => [x.key, x]));
const byKey = (key: string) => properties.get(key)!;
const state = (extra: Partial<TableState> = {}): TableState => ({
  columns: defaultColumns(type),
  sort: [{ property: "title", direction: "asc" }],
  groupBy: null,
  search: "",
  where: null,
  ...extra,
});

describe("D2-1 totals by column kind", () => {
  it("offers count, empty and filled for every column, sum and average for numbers, minimum and maximum for numbers and dates", () => {
    expect(allowedTotals(byKey("title"))).toEqual(["none", "count", "count_empty", "count_filled"]);
    expect(allowedTotals(byKey("status"))).toEqual(["none", "count", "count_empty", "count_filled"]);
    expect(allowedTotals(byKey("estimate"))).toEqual(["none", "count", "count_empty", "count_filled", "sum", "avg", "min", "max"]);
    expect(allowedTotals(byKey("due"))).toEqual(["none", "count", "count_empty", "count_filled", "min", "max"]);
    expect(allowedTotals(byKey("done"))).not.toContain("sum");
  });

  it("asks lens_aggregate for one measure per shown column, in column order, and the engine's parser accepts them", () => {
    const shown = defaultColumns(type);
    const { columns, measures } = measuresFor(shown, properties, { status: "count_filled", due: "max", estimate: "avg" });
    expect(columns.map((c) => [c.column, c.fn, c.id])).toEqual([
      ["title", "count", "m0"],
      ["status", "count_filled", "m1"],
      ["due", "max", "m2"],
      ["estimate", "avg", "m3"],
    ]);
    expect(measures).toEqual([
      { fn: "count" },
      { fn: "count_filled", property: "status" },
      { fn: "max", property: "due" },
      { fn: "avg", property: "estimate" },
    ]);
    expect(parseMeasures(measures)).toEqual(measures);
  });

  it("totals every matching row: the spec has no page, limit, offset or sort", () => {
    const spec = aggregateSpecFor("task", state());
    expect(spec).toEqual({ version: 1, type: "task" });
    expect(parseLensSpec(spec)).toBeTruthy();
  });

  it("never sends more measures than the engine allows, and skips columns set to none or filter-only", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: "title", width: 100, hidden: false, i }));
    expect(measuresFor(many as never, properties, null).measures).toHaveLength(20);
    const { columns } = measuresFor(
      [{ key: "title", width: 1, hidden: false }, { key: "review_role", width: 1, hidden: false }],
      properties,
      { title: "none" },
    );
    expect(columns).toEqual([]);
  });

  it("maps the engine's answer back to columns", () => {
    const { columns } = measuresFor(defaultColumns(type), properties, null);
    const totals = overallTotals(
      { type: "task", measures: [], totals: { m0: 3, m1: 5.5 }, groupBy: null, groups: null },
      columns,
    );
    expect(totals).toEqual({ title: 3, estimate: 5.5 });
  });
});

describe("D2-3 totals follow filters and grouping", () => {
  it("passes the table's filters, title search and grouping to the totals", () => {
    const where = { and: [{ property: "status", operator: "is", value: "ready" }] };
    const spec = aggregateSpecFor("task", state({ where: where as never, search: "gala", groupBy: "status" }));
    expect(spec.where).toEqual({ and: [...where.and, { property: "title", operator: "contains", value: "gala" }] });
    expect(spec.groupBy).toEqual({ property: "status" });
  });

  it("labels each group's totals the way the table labels its groups", () => {
    const { columns } = measuresFor(defaultColumns(type), properties, null);
    const rows = groupTotalsRows(
      {
        type: "task",
        measures: [],
        totals: {},
        groupBy: "status",
        groups: [
          { key: "ready", label: null, totals: { m0: 2, m1: 2.5 } },
          { key: null, label: null, totals: { m0: 1, m1: null } },
        ],
      },
      columns,
      byKey("status"),
      "fr-CA",
      "Non défini",
    );
    expect(rows).toEqual([
      { key: "ready", label: "Prête", values: { title: 2, estimate: 2.5 } },
      { key: null, label: "Non défini", values: { title: 1, estimate: null } },
    ]);
    const people = groupTotalsRows(
      { type: "task", measures: [], totals: {}, groupBy: "assignee", groups: [{ key: "u1", label: { id: "u1", label: "Ana" }, totals: { m0: 4 } }] },
      columns,
      byKey("assignee"),
      "en",
      "Not set",
    );
    expect(people[0].label).toBe("Ana");
  });
});

describe("D2-4 the viewer's totals choice is kept", () => {
  it("uses the saved choice when it suits the column, the default otherwise", () => {
    expect(totalFor(byKey("estimate"), { estimate: "avg" })).toBe("avg");
    expect(totalFor(byKey("estimate"), null)).toBe("sum");
    expect(totalFor(byKey("title"), null)).toBe("count");
    expect(totalFor(byKey("status"), null)).toBe("none");
    // A saved "sum" on a text column (the column changed kind) falls back.
    expect(totalFor(byKey("status"), { status: "sum" })).toBe("none");
  });

  it("validates what is saved", () => {
    expect(totalsChoicesSchema.safeParse({ estimate: "avg", title: "none" }).success).toBe(true);
    expect(totalsChoicesSchema.safeParse({ estimate: "median" }).success).toBe(false);
    expect(totalsChoicesSchema.safeParse({ "Bad Key": "sum" }).success).toBe(false);
    expect(totalsSaveSchema.safeParse({ type: "task", choices: {}, extra: 1 }).success).toBe(false);
  });

  it("loads the viewer's saved totals and the organization's columns with the type, under the viewer's own reads", async () => {
    const reads: { table: string; filters: [string, string][] }[] = [];
    const client = {
      from(table: string) {
        const filters: [string, string][] = [];
        reads.push({ table, filters });
        const data =
          table === "lens_column_setting"
            ? [{ property_key: "status", name_en: "Stage", name_fr: "Étape", hidden: false }, { property_key: "due", name_en: null, name_fr: null, hidden: true }]
            : { choices: { estimate: "avg" } };
        const q = {
          select: () => q,
          eq: (column: string, value: string) => {
            filters.push([column, value]);
            return q;
          },
          maybeSingle: async () => ({ data, error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
        };
        return q;
      },
    };
    const loaded = await withD2Columns(client, { userId: "me", organizationId: "org", isAdmin: false }, type);
    const info = d2Info(loaded)!;
    expect(info.totals).toEqual({ estimate: "avg" });
    expect(info.canManage).toBe(false);
    expect(info.hidden).toEqual(["due"]);
    expect(loaded.properties.find((x) => x.key === "status")!.name).toEqual({ en: "Stage", fr: "Étape" });
    expect(reads.find((r) => r.table === "lens_totals_setting")!.filters).toEqual([["user_id", "me"], ["type_key", "task"]]);
    expect(reads.find((r) => r.table === "lens_column_setting")!.filters).toEqual([["organization_id", "org"], ["type_key", "task"]]);
  });

  it("opens the table with defaults when the settings cannot be read", async () => {
    const client = { from: () => { throw new Error("offline"); } };
    const loaded = await withD2Columns(client, { userId: "me", organizationId: "org", isAdmin: true }, type);
    expect(d2Info(loaded)!.totals).toBeNull();
    expect(loaded.properties.map((x) => x.name)).toEqual(type.properties.map((x) => x.name));
  });
});

describe("D2-5 columns for everyone", () => {
  it("renames and hides columns from the catalog; a hidden column stays a filter so saved lenses keep their conditions", () => {
    const { type: applied, hidden } = applyColumnSettings(type, [
      { property_key: "estimate", name_en: "Hours", name_fr: "Heures", hidden: false },
      { property_key: "status", name_en: null, name_fr: null, hidden: true },
      { property_key: "title", name_en: null, name_fr: null, hidden: true },
    ]);
    expect(hidden).toEqual(["status"]);
    expect(applied.properties.find((x) => x.key === "estimate")!.name).toEqual({ en: "Hours", fr: "Heures" });
    expect(applied.properties.find((x) => x.key === "title")!.filterOnly).toBeUndefined();
    expect(defaultColumns(applied).map((c) => c.key)).not.toContain("status");
    expect(reconcileColumns(applied, defaultColumns(type)).map((c) => c.key)).not.toContain("status");
    const lens = stateFromLens(applied, { where: { and: [{ property: "status", operator: "is", value: "ready" }] } }, {});
    expect(lens.where).toEqual({ and: [{ property: "status", operator: "is", value: "ready" }] });
  });

  it("offers rename, hide and add to admins only, and never hide on the title", () => {
    const t = ((key: string) => key) as never;
    const admin = { ...type, d2: { canManage: true, totals: null, hidden: [], original: {} } };
    const member = { ...type, d2: { canManage: false, totals: null, hidden: [], original: {} } };
    const ctx = (tp: CatalogType, key: string) => ({ type: tp, property: byKey(key), state: state(), update: () => {}, t });
    expect(d2ColumnItems(ctx(admin, "status")).map((i) => i.label)).toEqual([
      "units.d2.columns.rename",
      "units.d2.columns.hide",
      "units.d2.columns.add",
    ]);
    expect(d2ColumnItems(ctx(admin, "title")).map((i) => i.label)).toEqual(["units.d2.columns.rename", "units.d2.columns.add"]);
    expect(d2ColumnItems(ctx(member, "status"))).toEqual([]);
    expect(d2ColumnItems(ctx(type, "status"))).toEqual([]);
  });

  it("validates renames", () => {
    expect(columnRenameSchema.safeParse({ type: "task", property: "status", nameEn: "Stage", nameFr: "Étape" }).success).toBe(true);
    expect(columnRenameSchema.safeParse({ type: "task", property: "status", nameEn: " ", nameFr: "Étape" }).success).toBe(false);
    expect(columnRenameSchema.safeParse({ type: "task", property: "status", nameEn: "x".repeat(81), nameFr: "y" }).success).toBe(false);
  });
});
