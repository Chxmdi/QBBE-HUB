import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * Wave 2 unit D2: the server refuses column changes from anyone who is not
 * an owner or admin, and anything with the wos_lenses switch off, before it
 * writes; a totals choice is validated against the column's kind.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";

let isAdmin = true;
let enabled = true;
let limited = false;
let tableCalls: TableCall[] = [];
let tableAnswer: { data: unknown; error: { message: string; code?: string } | null } = { data: { property_key: "status" }, error: null };

const catalog = {
  task: {
    key: "task",
    name: { en: "Task", fr: "Tâche" },
    properties: [
      { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true, groupable: false },
      { key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, sortable: true, groupable: true },
      { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate", fr: "Estimation" }, sortable: true, groupable: false },
      { key: "review_role", kind: "person", propertyKind: "person", name: { en: "Role", fr: "Rôle" }, filterOnly: true },
    ],
  },
};

vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => enabled }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME, organizationId: ORG, isAdmin }) }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async (action: string) => (limited ? { ok: false, error: `limited ${action}` } : null),
}));
vi.mock("@/features/lenses/i18n/server", () => ({ getLensT: async () => (key: string) => key }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({
      table: () => tableAnswer,
      rpc: ({ fn }) => (fn === "lens_catalog" ? { data: catalog, error: null } : { data: null, error: { message: "unexpected" } }),
    });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { renameColumnForEveryone, setColumnHiddenForEveryone, saveTotalsChoice } = await import("./d2-columns.actions");

const writes = () => tableCalls.filter((c) => c.action !== "select");

beforeEach(() => {
  isAdmin = true;
  enabled = true;
  limited = false;
  tableCalls = [];
  tableAnswer = { data: { property_key: "status" }, error: null };
});

describe("D2-5 column changes for everyone", () => {
  it("an admin renames a column for the organization", async () => {
    const result = await renameColumnForEveryone({ type: "task", property: "status", nameEn: " Stage ", nameFr: "Étape" });
    expect(result).toEqual({ ok: true });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      table: "lens_column_setting",
      action: "upsert",
      payload: { organization_id: ORG, type_key: "task", property_key: "status", name_en: "Stage", name_fr: "Étape" },
    });
  });

  it("an admin hides a column and adds it back", async () => {
    expect(await setColumnHiddenForEveryone({ type: "task", property: "estimate", hidden: true })).toEqual({ ok: true });
    expect(await setColumnHiddenForEveryone({ type: "task", property: "estimate", hidden: false })).toEqual({ ok: true });
    expect(writes()[0].payload).toMatchObject({ property_key: "estimate", hidden: false });
  });

  it("refuses someone who is not an owner or admin, before any write", async () => {
    isAdmin = false;
    expect(await renameColumnForEveryone({ type: "task", property: "status", nameEn: "X", nameFr: "Y" })).toEqual({
      ok: false,
      error: "units.d2.columns.notAllowed",
    });
    expect(await setColumnHiddenForEveryone({ type: "task", property: "status", hidden: true })).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });

  it("reports the database's refusal (RLS) as not allowed", async () => {
    tableAnswer = { data: null, error: { message: "denied", code: "42501" } };
    expect(await setColumnHiddenForEveryone({ type: "task", property: "status", hidden: true })).toEqual({
      ok: false,
      error: "units.d2.columns.notAllowed",
    });
  });

  it("refuses unknown or filter-only columns, hiding the title and malformed input", async () => {
    expect((await setColumnHiddenForEveryone({ type: "task", property: "nope", hidden: true })).ok).toBe(false);
    expect((await setColumnHiddenForEveryone({ type: "task", property: "review_role", hidden: true })).ok).toBe(false);
    expect((await setColumnHiddenForEveryone({ type: "task", property: "title", hidden: true })).ok).toBe(false);
    expect((await renameColumnForEveryone({ type: "task", property: "status", nameEn: "", nameFr: "Y" })).ok).toBe(false);
    expect((await renameColumnForEveryone({ type: "task'; drop", property: "status", nameEn: "a", nameFr: "b" })).ok).toBe(false);
    expect(writes()).toEqual([]);
  });

  it("is rate limited", async () => {
    limited = true;
    expect(await renameColumnForEveryone({ type: "task", property: "status", nameEn: "a", nameFr: "b" })).toEqual({
      ok: false,
      error: "limited property:write",
    });
    expect(writes()).toEqual([]);
  });

  it("cannot be called with the switch off [switch off]", async () => {
    enabled = false;
    expect((await renameColumnForEveryone({ type: "task", property: "status", nameEn: "a", nameFr: "b" })).ok).toBe(false);
    expect((await setColumnHiddenForEveryone({ type: "task", property: "status", hidden: true })).ok).toBe(false);
    expect((await saveTotalsChoice({ type: "task", choices: { estimate: "avg" } })).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});

describe("D2-4 saving the viewer's totals", () => {
  it("keeps the choice for this viewer and type", async () => {
    expect(await saveTotalsChoice({ type: "task", choices: { estimate: "avg", title: "count" } })).toEqual({ ok: true });
    expect(writes()[0]).toMatchObject({
      table: "lens_totals_setting",
      action: "upsert",
      payload: { user_id: ME, type_key: "task", choices: { estimate: "avg", title: "count" } },
    });
  });

  it("drops stale entries (a removed or filter-only column, a total the kind does not have) and saves the rest", async () => {
    expect(
      await saveTotalsChoice({ type: "task", choices: { status: "sum", nope: "count", review_role: "count", estimate: "max" } }),
    ).toEqual({ ok: true });
    expect(writes()[0].payload).toMatchObject({ choices: { estimate: "max" } });
    expect(Object.keys((writes()[0].payload as { choices: object }).choices)).toEqual(["estimate"]);
  });

  it("refuses unknown totals, unknown types and malformed input", async () => {
    expect((await saveTotalsChoice({ type: "task", choices: { estimate: "median" } })).ok).toBe(false);
    expect((await saveTotalsChoice({ type: "task", choices: "count" })).ok).toBe(false);
    expect((await saveTotalsChoice({ type: "ghost", choices: {} })).ok).toBe(false);
    expect(writes()).toEqual([]);
  });
});
