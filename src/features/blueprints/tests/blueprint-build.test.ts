import { describe, expect, it } from "vitest";
import { validateBlueprint, type Blueprint, type BlueprintInput } from "../schema";
import { applyBlueprintBuild, rowsToUndo, undoBlueprintChanges, type BuildClient } from "../services/blueprint.build";

/**
 * Building against a fake database: every table write and every function
 * call is recorded, so the tests check what the build asks the database to
 * do (and in what order) without a database.
 */

type Call = { table?: string; op: string; args: unknown[] };

interface FakeOptions {
  /** Rows the "database" already has, by table. */
  rows?: Record<string, Record<string, unknown>[]>;
  /** Fails the n-th write (1-based) with this message. */
  failWrite?: { at: number; message: string; code?: string };
  /** Fails a named function with this message. */
  failRpc?: Record<string, string>;
}

function fakeClient(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const rows: Record<string, Record<string, unknown>[]> = structuredClone(options.rows ?? {});
  let ids = 0;
  let writes = 0;
  const table = (name: string) => rows[name] ?? (rows[name] = []);

  const builder = (name: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> = {};
    const run = () => {
      if (op === "select") {
        return { data: table(name).filter((row) => filters.every((f) => f(row))), error: null };
      }
      writes += 1;
      if (options.failWrite && options.failWrite.at === writes) {
        return { data: null, error: { message: options.failWrite.message, code: options.failWrite.code } };
      }
      if (op === "insert") {
        const row = { id: `${name}-${++ids}`, archived_at: null, ...payload };
        table(name).push(row);
        return { data: [row], error: null };
      }
      const matched = table(name).filter((row) => filters.every((f) => f(row)));
      for (const row of matched) Object.assign(row, payload);
      return { data: matched, error: null };
    };
    const chain = {
      select: (columns?: string) => {
        calls.push({ table: name, op: op === "select" ? "select" : `${op}.select`, args: [columns] });
        return chain;
      },
      insert: (values: Record<string, unknown>) => {
        op = "insert";
        payload = values;
        calls.push({ table: name, op: "insert", args: [values] });
        return chain;
      },
      update: (values: Record<string, unknown>) => {
        op = "update";
        payload = values;
        calls.push({ table: name, op: "update", args: [values] });
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return chain;
      },
      single: async () => {
        const result = run();
        return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : null, error: result.error };
      },
      maybeSingle: async () => {
        const result = run();
        return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };

  const client = {
    calls,
    rows,
    from: (name: string) => builder(name),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ op: `rpc:${fn}`, args: [args] });
      if (options.failRpc?.[fn]) return { data: null, error: { message: options.failRpc[fn] } };
      if (fn === "create_native_relation_property" || fn === "create_rollup_property") {
        const row = {
          id: `property_definition-${++ids}`,
          type_id: args.p_type,
          key: args.p_key,
          kind: fn === "create_rollup_property" ? "rollup" : "relation",
          archived_at: null,
          position: 99,
        };
        table("property_definition").push(row);
        return { data: row.id, error: null };
      }
      if (fn === "blueprint_build") {
        const row = { change_set_id: "cs-1", changes: args.p_changes, undone_at: null };
        table("blueprint_build").push(row);
        return { data: "cs-1", error: null };
      }
      if (fn === "blueprint_undo_build") {
        for (const row of table("blueprint_build")) row.undone_at = "now";
        return { data: "undo-1", error: null };
      }
      return { data: null, error: { message: `unknown function ${fn}` } };
    },
  };
  return client;
}

function blueprint(): Blueprint {
  const input: BlueprintInput = {
    version: 1,
    key: "grants",
    name: { en: "Grants", fr: "Subventions" },
    description: { en: "", fr: "" },
    types: [
      {
        key: "grant_application",
        name: { en: "Application", fr: "Demande" },
        properties: [
          { key: "hours_total", name: { en: "Hours", fr: "Heures" }, kind: "rollup", rollup: { relation: "reports", target: "hours", function: "sum" } },
          { key: "requested", name: { en: "Requested", fr: "Demandé" }, kind: "currency", currency: "CAD" },
          { key: "double", name: { en: "Double", fr: "Double" }, kind: "formula", expression: 'prop("requested") * 2' },
          { key: "reports", name: { en: "Reports", fr: "Rapports" }, kind: "relation", relation: "reports_on" },
        ],
      },
      {
        key: "grant_report",
        name: { en: "Report", fr: "Rapport" },
        properties: [
          { key: "hours", name: { en: "Hours", fr: "Heures" }, kind: "number" },
          { key: "grant", name: { en: "Grant", fr: "Subvention" }, kind: "relation", relation: "reports_on" },
        ],
      },
    ],
    relations: [
      {
        key: "reports_on",
        from: "grant_report",
        to: "grant_application",
        name: { en: "reports on", fr: "rend compte de" },
        reverseName: { en: "reports", fr: "rapports" },
        cardinality: "one_to_many",
      },
    ],
  };
  const result = validateBlueprint(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.blueprint;
}

const org = "org-1";
const build = (client: ReturnType<typeof fakeClient>) =>
  applyBlueprintBuild(client as unknown as BuildClient, { blueprintId: "bp-1", organizationId: org, blueprint: blueprint() });

describe("applyBlueprintBuild", () => {
  it("creates types, the relation, then every property in dependency order with the right function", async () => {
    const client = fakeClient();
    const result = await build(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const writes = client.calls.filter((c) => c.op === "insert" || c.op.startsWith("rpc:"));
    expect(writes.map((c) => (c.table ? `${c.op} ${c.table}` : c.op) + " " + ((c.args[0] as { key?: string; p_key?: string }).key ?? (c.args[0] as { p_key?: string }).p_key ?? ""))).toEqual([
      "insert object_type grant_application",
      "insert object_type grant_report",
      "insert relation_type reports_on",
      "insert property_definition requested",
      "rpc:create_native_relation_property reports",
      "insert property_definition hours",
      "rpc:create_native_relation_property grant",
      "rpc:create_rollup_property hours_total",
      "insert property_definition double",
      "rpc:blueprint_build ",
    ]);

    const type = client.rows.object_type[0];
    expect(type).toMatchObject({ organization_id: org, key: "grant_application", kind: "custom", default_lens: "table", name_fr: "Demande" });
    expect(client.rows.relation_type[0]).toMatchObject({
      key: "reports_on",
      from_type_id: "object_type-2",
      to_type_id: "object_type-1",
      cardinality: "one_to_many",
      is_native: false,
    });
    const formula = client.rows.property_definition.find((p) => p.key === "double");
    expect(formula).toMatchObject({ type_id: "object_type-1", kind: "formula", options: { expression: 'prop("requested") * 2' }, position: 2 });

    const relation = client.calls.find((c) => c.op === "rpc:create_native_relation_property");
    expect(relation?.args[0]).toEqual({
      p_type: "object_type-1",
      p_key: "reports",
      p_name_en: "Reports",
      p_name_fr: "Rapports",
      p_relation_type_key: "reports_on",
      p_direction: "incoming",
      p_target_type_key: "grant_report",
    });
    const rollup = client.calls.find((c) => c.op === "rpc:create_rollup_property");
    expect(rollup?.args[0]).toEqual({
      p_type: "object_type-1",
      p_key: "hours_total",
      p_name_en: "Hours",
      p_name_fr: "Heures",
      p_relation_property: "reports",
      p_target_property: "hours",
      p_function: "sum",
    });
    // Rows the definer functions appended are moved to where they were drawn.
    expect(client.rows.property_definition.find((p) => p.key === "hours_total")).toMatchObject({ position: 0 });

    // The recorded change set carries the real ids and how each row was applied.
    const recorded = (client.calls.find((c) => c.op === "rpc:blueprint_build")?.args[0] as { p_changes: { object: { id: string; type: string }; values: { key?: string; applied: string; blueprint_key: string } }[] }).p_changes;
    expect(recorded.every((c) => c.values.blueprint_key === "grants")).toBe(true);
    expect(recorded.filter((c) => c.object.type === "property_definition").map((c) => c.values.applied)).toEqual(Array(6).fill("created"));
    expect(recorded.find((c) => c.values.key === "double")?.object.id).toBe(formula?.id);
    expect(recorded.filter((c) => c.object.type === "lens").map((c) => c.values.applied)).toEqual(["recorded", "recorded"]);
    expect(result.changeSetId).toBe("cs-1");
    expect(rowsToUndo(recorded)).toHaveLength(9);
  });

  it("is idempotent: existing live rows are reused and archived ones restored, never created twice", async () => {
    const client = fakeClient({
      rows: {
        object_type: [
          { id: "t-app", organization_id: org, key: "grant_application", kind: "custom", archived_at: null },
          { id: "t-rep", organization_id: org, key: "grant_report", kind: "custom", archived_at: "2026-01-01" },
        ],
        property_definition: [{ id: "p-req", type_id: "t-app", key: "requested", kind: "currency", archived_at: null }],
      },
    });
    const result = await build(client);
    expect(result.ok).toBe(true);
    expect(client.calls.filter((c) => c.op === "insert" && c.table === "object_type")).toHaveLength(0);
    expect(client.calls.filter((c) => c.op === "insert" && c.table === "property_definition").map((c) => (c.args[0] as { key: string }).key)).toEqual(["hours", "double"]);
    expect(client.rows.object_type[1]).toMatchObject({ archived_at: null, name_en: "Report" });
    const recorded = (client.calls.find((c) => c.op === "rpc:blueprint_build")?.args[0] as { p_changes: { values: { key?: string; applied: string } }[] }).p_changes;
    const applied = Object.fromEntries(recorded.filter((c) => c.values.key).map((c) => [c.values.key, c.values.applied]));
    expect(applied).toMatchObject({ grant_application: "existing", grant_report: "restored", requested: "existing", reports_on: "created", hours_total: "created" });
    // Undo touches only what this build created or restored.
    expect(rowsToUndo(recorded).map((r) => r.id)).toEqual(["t-rep", "relation_type-1", "property_definition-2", "property_definition-3", "property_definition-4", "property_definition-5", "property_definition-6"]);
  });

  it("refuses a property that exists with a different kind, before writing anything", async () => {
    const client = fakeClient({
      rows: {
        object_type: [{ id: "t-app", organization_id: org, key: "grant_application", kind: "custom", archived_at: null }],
        property_definition: [{ id: "p-req", type_id: "t-app", key: "requested", kind: "text", archived_at: null }],
      },
    });
    const result = await build(client);
    expect(result).toEqual({ ok: false, failure: { code: "propertyKindClash", key: "requested" }, rolledBack: true });
    // The report type was created before the clash was found, and archived again.
    expect(client.rows.object_type.find((t) => t.key === "grant_report")?.archived_at).not.toBeNull();
    expect(client.calls.some((c) => c.op === "rpc:blueprint_build")).toBe(false);
  });

  it("archives what it created, newest first, when the database refuses a step", async () => {
    const client = fakeClient({ failRpc: { create_rollup_property: "A sum needs a number property on the related items." } });
    const result = await build(client);
    expect(result).toEqual({
      ok: false,
      failure: { code: "database", error: { message: "A sum needs a number property on the related items." } },
      rolledBack: true,
    });
    const archived = client.calls.filter((c) => c.op === "update" && (c.args[0] as { archived_at?: unknown }).archived_at);
    expect(archived.map((c) => c.table)).toEqual([
      "property_definition", "property_definition", "property_definition", "property_definition",
      "relation_type", "object_type", "object_type",
    ]);
    expect(client.rows.object_type.every((t) => t.archived_at !== null)).toBe(true);
  });

  it("rolls back when the build cannot be recorded", async () => {
    const client = fakeClient({ failRpc: { blueprint_build: "Approve the blueprint before building it." } });
    const result = await build(client);
    expect(result.ok).toBe(false);
    expect(client.rows.property_definition.every((p) => p.archived_at !== null)).toBe(true);
  });
});

describe("undoBlueprintChanges", () => {
  it("archives created rows newest first and then marks the build undone", async () => {
    const client = fakeClient();
    await build(client);
    client.calls.length = 0;
    const result = await undoBlueprintChanges(client as unknown as BuildClient, "cs-1");
    expect(result).toEqual({ ok: true });
    const updates = client.calls.filter((c) => c.op === "update");
    expect(updates.map((c) => c.table)).toEqual([
      ...Array(6).fill("property_definition"), "relation_type", "object_type", "object_type",
    ]);
    expect(client.calls.at(-1)).toMatchObject({ op: "rpc:blueprint_undo_build", args: [{ p_change_set: "cs-1" }] });
    expect(client.rows.object_type.every((t) => t.archived_at !== null)).toBe(true);
    expect(client.rows.blueprint_build[0].undone_at).toBe("now");
  });

  it("brings the rows back when the database refuses the undo", async () => {
    const client = fakeClient({ failRpc: { blueprint_undo_build: "Builds can be undone for 30 days." } });
    await build(client);
    const result = await undoBlueprintChanges(client as unknown as BuildClient, "cs-1");
    expect(result).toMatchObject({ ok: false, restored: true, error: { message: "Builds can be undone for 30 days." } });
    expect(client.rows.object_type.every((t) => t.archived_at === null)).toBe(true);
    expect(client.rows.property_definition.every((p) => p.archived_at === null)).toBe(true);
  });

  it("does nothing for a build that was already undone", async () => {
    const client = fakeClient({ rows: { blueprint_build: [{ change_set_id: "cs-9", changes: [], undone_at: "then" }] } });
    const result = await undoBlueprintChanges(client as unknown as BuildClient, "cs-9");
    expect(result.ok).toBe(false);
    expect(client.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});
