import { describe, expect, it } from "vitest";
import type { PropertyDefinition } from "@/lib/objects/contracts";
import type { LayoutCatalog } from "@/features/object-layouts/layout";
import { defaultLayout } from "@/features/object-layouts/layout";
import type { ObjectPageData } from "@/features/object-layouts/services/layout.queries";
import {
  fieldMode,
  loadRecordPage,
  readOnlyReason,
  nativeValue,
  toFormulaValue,
  type RecordPageDeps,
} from "@/features/objects/services/record-page.queries";

const ORG = "00000000-0000-0000-0000-00000000000a";
const DONOR_TYPE = "10000000-0000-0000-0000-000000000001";
const TASK_TYPE = "10000000-0000-0000-0000-000000000002";
const DONOR = "20000000-0000-0000-0000-000000000001";
const TASK = "20000000-0000-0000-0000-000000000002";
const OWNER = "30000000-0000-0000-0000-000000000001";
const STAFF = "30000000-0000-0000-0000-000000000002";
const PROJECT = "40000000-0000-0000-0000-000000000001";

type Row = Record<string, unknown>;

/**
 * A stand-in for the Supabase client: tables in memory, the filters the
 * queries use (eq, is, in) applied, joins already shaped as PostgREST returns
 * them, and the two RPCs the loader asks.
 */
function fakeClient(tables: Record<string, Row[]>, rpc: { hidden?: unknown; hiddenError?: boolean; canEdit?: boolean }) {
  const calls: { table: string; filters: [string, unknown][] }[] = [];
  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const call = { table, filters };
    calls.push(call);
    let single = false;
    const run = () => {
      let rows = tables[table] ?? [];
      for (const [column, value] of filters) {
        if (column.startsWith("in:")) rows = rows.filter((row) => (value as unknown[]).includes(row[column.slice(3)]));
        else rows = rows.filter((row) => !(column in row) || row[column] === value);
      }
      return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    };
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
      is: (column: string, value: unknown) => (filters.push([column, value]), chain),
      in: (column: string, values: unknown[]) => (filters.push([`in:${column}`, values]), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => ((single = true), chain),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }
  return {
    calls,
    from: (table: string) => builder(table),
    rpc: async (name: string) => {
      if (name === "hidden_property_keys") {
        return rpc.hiddenError ? { data: null, error: { message: "boom" } } : { data: rpc.hidden ?? [], error: null };
      }
      if (name === "can") return { data: rpc.canEdit ?? true, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
}

const definition = (over: Partial<PropertyDefinition> & Pick<PropertyDefinition, "key" | "kind">, typeId = DONOR_TYPE): Row => ({
  id: `d-${over.key}`,
  type_id: typeId,
  key: over.key,
  name_en: over.name?.en ?? over.key,
  name_fr: over.name?.fr ?? over.key,
  kind: over.kind,
  options: over.options ?? {},
  system_column: over.systemColumn ?? null,
  visible_to_roles: over.visibleToRoles ?? null,
  position: over.position ?? 0,
  archived_at: null,
});

const objectRow = (id: string, typeKey: string, title: string): Row => ({
  id,
  organization_id: ORG,
  space_id: null,
  parent_object_id: null,
  title,
  icon: null,
  cover: null,
  owner_id: OWNER,
  created_by: OWNER,
  created_at: "2026-09-01T12:00:00Z",
  updated_by: OWNER,
  updated_at: "2026-09-02T12:00:00Z",
  archived_at: null,
  deleted_at: null,
  object_type: { key: typeKey },
});

const types: Row[] = [
  { id: DONOR_TYPE, key: "donor", name_en: "Donor", name_fr: "Donateur", icon: null, kind: "custom", native_table: null, default_lens: "table", default_template_id: null, organization_id: ORG, archived_at: null },
  { id: TASK_TYPE, key: "task", name_en: "Task", name_fr: "Tâche", icon: null, kind: "native", native_table: "task", default_lens: "table", default_template_id: null, organization_id: ORG, archived_at: null },
];

const value = (objectId: string, key: string, kind: string, columns: Row): Row => ({
  object_id: objectId,
  value_text: null,
  value_number: null,
  value_date: null,
  value_date_end: null,
  value_bool: null,
  value_uuids: null,
  value_json: null,
  ...columns,
  property: { key, kind },
});

const donorDefinitions: Row[] = [
  definition({ key: "name", kind: "text", name: { en: "Name", fr: "Nom" }, position: 1 }),
  definition({ key: "gift", kind: "currency", name: { en: "Gift", fr: "Don" }, position: 2 }),
  definition({ key: "recurring", kind: "checkbox", name: { en: "Recurring", fr: "Récurrent" }, position: 3 }),
  definition({ key: "doubled", kind: "formula", name: { en: "Doubled", fr: "Doublé" }, options: { expression: 'prop("gift") * 2' }, position: 4 }),
  definition({ key: "gifts_total", kind: "rollup", name: { en: "Gifts total", fr: "Total des dons" }, options: { relationProperty: "gifts", function: "sum", targetProperty: "amount" }, position: 5 }),
  definition({ key: "steward", kind: "person", name: { en: "Steward", fr: "Responsable" }, position: 6 }),
  definition({ key: "health_notes", kind: "text", name: { en: "Health notes", fr: "Notes de santé" }, visibleToRoles: ["owner"], position: 7 }),
  definition({ key: "created_time", kind: "created_time", name: { en: "Created", fr: "Créé" }, position: 8 }),
];

const shared = {
  object_type: types,
  organization_membership: [
    { organization_id: ORG, status: "active", user_id: OWNER, user_profile: { full_name: "QA Owner" } },
    { organization_id: ORG, status: "active", user_id: STAFF, user_profile: { full_name: "QA Staff" } },
  ],
  user_profile: [{ id: OWNER, full_name: "QA Owner" }, { id: STAFF, full_name: "QA Staff" }],
  document: [],
};

function deps(client: ReturnType<typeof fakeClient>, extra: Partial<RecordPageDeps> = {}): RecordPageDeps {
  const seen: LayoutCatalog[] = [];
  return {
    client: client as unknown as RecordPageDeps["client"],
    locale: "en",
    now: () => new Date("2026-10-01T12:00:00Z"),
    loadLayout: async (_typeId, catalog) => {
      seen.push(catalog);
      return { layout: defaultLayout(catalog) };
    },
    loadTaskPage: async () => null,
    ...extra,
  };
}

describe("loadRecordPage", () => {
  const donorTables = {
    ...shared,
    object: [objectRow(DONOR, "donor", "Harvest Foundation")],
    property_definition: donorDefinitions,
    property_value: [
      value(DONOR, "name", "text", { value_text: "Harvest Foundation" }),
      value(DONOR, "gift", "currency", { value_number: 1250 }),
      value(DONOR, "recurring", "checkbox", { value_bool: true }),
      value(DONOR, "gifts_total", "rollup", { value_number: 4800 }),
      value(DONOR, "steward", "person", { value_uuids: [STAFF] }),
      value(DONOR, "health_notes", "text", { value_text: "private" }),
    ],
  };

  it("returns the object, its visible properties in order, decoded values, formulas and rollups", async () => {
    const client = fakeClient(donorTables, { hidden: ["health_notes"], canEdit: true });
    const data = await loadRecordPage(DONOR, deps(client));
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.type.key).toBe("donor");
    expect(Object.keys(data.properties)).toEqual(["title", "name", "gift", "recurring", "doubled", "gifts_total", "steward", "created_time"]);
    expect(data.properties.gift.value).toEqual({ kind: "currency", value: 1250 });
    expect(data.properties.recurring.value).toEqual({ kind: "checkbox", value: true });
    expect(data.properties.doubled.value).toEqual({ kind: "formula", value: 2500 });
    expect(data.properties.doubled.formula).toEqual({ ok: true, value: 2500 });
    expect(data.properties.gifts_total.value).toEqual({ kind: "rollup", value: 4800 });
    expect(data.properties.steward.value).toEqual({ kind: "person", value: [STAFF] });
    expect(data.people[STAFF]).toBe("QA Staff");
    expect(data.members.map((member) => member.name)).toEqual(["QA Owner", "QA Staff"]);
    expect(data.canEditFields).toBe(true);
    expect(data.canEdit).toBe(true);
    expect(data.editorType).toBeNull();
  });

  it("never shows a property the viewer may not see, and the formula cannot read it either", async () => {
    const client = fakeClient(donorTables, { hidden: ["health_notes", "gift"], canEdit: false });
    const data = await loadRecordPage(DONOR, deps(client));
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.properties.health_notes).toBeUndefined();
    expect(data.properties.gift).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("private");
    // The formula depends on the hidden gift: it is reported, not leaked.
    expect(data.properties.doubled.formula?.ok).toBe(false);
    expect(data.layout.sections[0]).toMatchObject({ kind: "properties" });
    expect((data.layout.sections[0] as { properties: string[] }).properties).not.toContain("health_notes");
  });

  it("fails closed when the database cannot say which properties are hidden", async () => {
    const client = fakeClient(donorTables, { hiddenError: true, canEdit: true });
    const data = await loadRecordPage(DONOR, deps(client));
    expect(data?.properties.health_notes).toBeUndefined();
    expect(data?.properties.name).toBeDefined();
  });

  it("marks each property with how it can be used", async () => {
    const editable = await loadRecordPage(DONOR, deps(fakeClient(donorTables, { canEdit: true })));
    expect(editable?.properties.name.mode).toBe("editable");
    expect(editable?.properties.steward.mode).toBe("editable");
    expect(editable?.properties.doubled.mode).toBe("derived");
    expect(editable?.properties.gifts_total.mode).toBe("derived");
    expect(editable?.properties.created_time.mode).toBe("derived");
    expect(editable?.properties.title.mode).toBe("readonly");

    expect(editable?.properties.doubled.reason).toBe("formula");
    expect(editable?.properties.name.reason).toBeNull();

    const viewer = await loadRecordPage(DONOR, deps(fakeClient(donorTables, { canEdit: false })));
    expect(viewer?.canEdit).toBe(false);
    expect(viewer?.properties.name.mode).toBe("readonly");
    // The section says once that the viewer may not edit; no per-field reason.
    expect(viewer?.properties.name.reason).toBeNull();
    expect(viewer?.properties.doubled.mode).toBe("derived");
  });

  it("does not load the member list for someone who cannot edit a person field", async () => {
    const client = fakeClient(donorTables, { canEdit: false });
    const data = await loadRecordPage(DONOR, deps(client));
    expect(data?.members).toEqual([]);
    expect(client.calls.some((call) => call.table === "organization_membership")).toBe(false);
    // Names of people already chosen are still shown.
    expect(data?.people[STAFF]).toBe("QA Staff");
  });

  it("locks every field of an archived object, and says why", async () => {
    const archived = { ...donorTables, object: [{ ...objectRow(DONOR, "donor", "Harvest Foundation"), archived_at: "2026-09-30T12:00:00Z" }] };
    const data = await loadRecordPage(DONOR, deps(fakeClient(archived, { canEdit: true })));
    expect(data?.canEdit).toBe(true);
    expect(data?.canEditFields).toBe(false);
    expect(data?.properties.name.mode).toBe("readonly");
    expect(data?.properties.name.reason).toBe("archived");
  });

  it("is null for an object that does not exist or the viewer cannot see", async () => {
    const client = fakeClient({ ...shared, object: [], property_definition: [], property_value: [] }, {});
    expect(await loadRecordPage(DONOR, deps(client))).toBeNull();
  });

  it("reads a task's native fields from its own table, keeps loadTaskPage's display forms, and asks for the task layout", async () => {
    const taskDefinitions = [
      definition({ key: "title", kind: "text", systemColumn: "title", position: 1 }, TASK_TYPE),
      definition({ key: "status", kind: "status", systemColumn: "status", options: { choices: [{ key: "ready", label: { en: "Ready", fr: "Prête" }, color: null }] }, position: 2 }, TASK_TYPE),
      definition({ key: "assignee", kind: "person", systemColumn: "assignee_id", position: 3 }, TASK_TYPE),
      definition({ key: "due", kind: "date", systemColumn: "due_at", position: 4 }, TASK_TYPE),
      definition({ key: "project", kind: "relation", systemColumn: "project_id", options: { relationTypeKey: "contains" }, position: 5 }, TASK_TYPE),
      definition({ key: "created_time", kind: "created_time", systemColumn: "created_at", position: 6 }, TASK_TYPE),
      definition({ key: "budget_code", kind: "text", position: 7 }, TASK_TYPE),
    ];
    const taskPage: ObjectPageData = {
      title: "Book venue",
      values: { project: { kind: "link", text: "Harvest dinner", href: `/projects/${PROJECT}` }, status: { kind: "text", text: "ready" } },
      related: { project: [], blocking: [], blocked_by: [] },
      content: "Call the hall.",
    };
    const client = fakeClient(
      {
        ...shared,
        object: [objectRow(TASK, "task", "Book venue"), objectRow(PROJECT, "project", "Harvest dinner")],
        property_definition: taskDefinitions,
        property_value: [value(TASK, "budget_code", "text", { value_text: "B-12" })],
        task: [{ id: TASK, title: "Book venue", status: "ready", assignee_id: STAFF, due_at: "2026-10-20", project_id: PROJECT, created_at: "2026-09-01T12:00:00Z" }],
      },
      { canEdit: true },
    );
    const catalogs: LayoutCatalog[] = [];
    const data = await loadRecordPage(
      TASK,
      deps(client, {
        loadTaskPage: async (id) => (id === TASK ? taskPage : null),
        loadLayout: async (_typeId, catalog) => {
          catalogs.push(catalog);
          return { layout: defaultLayout(catalog) };
        },
      }),
    );
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.editorType).toBe("task");
    expect(data.taskPage).toBe(taskPage);
    expect(data.properties.status.value).toEqual({ kind: "status", value: "ready" });
    expect(data.properties.status.mode).toBe("editable");
    expect(data.properties.assignee.value).toEqual({ kind: "person", value: [STAFF] });
    expect(data.properties.due.value).toEqual({ kind: "date", value: "2026-10-20" });
    expect(data.properties.project.mode).toBe("link");
    expect(data.properties.project.links).toEqual([{ id: PROJECT, title: "Harvest dinner", href: `/objects/${PROJECT}` }]);
    expect(data.properties.project.display).toEqual(taskPage.values.project);
    expect(data.properties.created_time.mode).toBe("derived");
    expect(data.properties.budget_code.value).toEqual({ kind: "text", value: "B-12" });
    expect(catalogs).toEqual([
      { properties: ["title", "status", "assignee", "due", "project", "created_time", "budget_code"], relations: ["project", "blocked_by", "blocking"] },
    ]);
  });
});

describe("record page helpers", () => {
  const base: PropertyDefinition = {
    id: "d",
    typeId: TASK_TYPE,
    key: "x",
    name: { en: "X", fr: "X" },
    kind: "text",
    options: {},
    systemColumn: null,
    visibleToRoles: null,
    position: 1,
  };

  it("turns native column values into property values", () => {
    expect(nativeValue({ ...base, kind: "person" }, STAFF)).toEqual({ kind: "person", value: [STAFF] });
    expect(nativeValue({ ...base, kind: "number" }, "4.5")).toEqual({ kind: "number", value: 4.5 });
    expect(nativeValue({ ...base, kind: "number" }, "many")).toBeNull();
    expect(nativeValue({ ...base, kind: "relation", options: { relationTypeKey: "contains" } }, PROJECT)).toEqual({
      kind: "relation",
      value: [{ id: PROJECT, type: "contains" }],
    });
    expect(nativeValue({ ...base, kind: "date" }, null)).toBeNull();
    expect(nativeValue({ ...base, kind: "text" }, "")).toBeNull();
  });

  it("gives formulas plain values: names for people, the start of a range, labels for places", () => {
    expect(toFormulaValue({ kind: "person", value: [STAFF, "nobody"] }, { [STAFF]: "QA Staff" })).toEqual(["QA Staff", "nobody"]);
    expect(toFormulaValue({ kind: "date_range", value: { start: "2026-10-01", end: null } }, {})).toBe("2026-10-01");
    expect(toFormulaValue({ kind: "location", value: { lat: 45.5, lng: -73.6, label: "Montréal" } }, {})).toBe("Montréal");
    expect(toFormulaValue({ kind: "checkbox", value: false }, {})).toBe(false);
    expect(toFormulaValue(null, {})).toBeNull();
  });

  it("decides the field mode from the kind, the viewer's rights and where the value lives", () => {
    const custom = { kind: "custom" as const, nativeTable: null };
    const native = { kind: "native" as const, nativeTable: "task" };
    expect(fieldMode(base, custom, true)).toBe("editable");
    expect(fieldMode(base, custom, false)).toBe("readonly");
    expect(fieldMode({ ...base, kind: "formula" }, custom, true)).toBe("derived");
    expect(fieldMode({ ...base, kind: "rollup" }, custom, true)).toBe("derived");
    expect(fieldMode({ ...base, kind: "edited_by" }, custom, true)).toBe("derived");
    expect(fieldMode({ ...base, kind: "relation" }, custom, true)).toBe("link");
    expect(fieldMode({ ...base, kind: "file" }, custom, true)).toBe("link");
    expect(fieldMode({ ...base, kind: "location" }, custom, true)).toBe("readonly");
    expect(fieldMode({ ...base, systemColumn: "status" }, native, true)).toBe("editable");
    expect(fieldMode({ ...base, systemColumn: "full_name" }, { kind: "native", nativeTable: "user_profile" }, true)).toBe("readonly");
    expect(fieldMode({ ...base, systemColumn: "drop table" }, native, true)).toBe("readonly");
    // A calendar-date column is editable; a timestamp would lose its time of day.
    expect(fieldMode({ ...base, kind: "date", systemColumn: "due_at" }, native, true)).toBe("editable");
    expect(fieldMode({ ...base, kind: "date", systemColumn: "starts_at" }, { kind: "native", nativeTable: "meeting" }, true)).toBe("readonly");
    expect(readOnlyReason({ ...base, kind: "date", systemColumn: "starts_at" }, { kind: "native", nativeTable: "meeting" }, true, false)).toBe("timestamp");
    expect(readOnlyReason({ ...base, kind: "location" }, custom, true, false)).toBe("location");
    expect(readOnlyReason(base, custom, false, false)).toBeNull();
  });
});
