import type { Locale } from "@/lib/i18n/config";
import type {
  ObjectRecord,
  ObjectType,
  PropertyDefinition,
  PropertyKind,
  PropertyValue,
  Uuid,
} from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";
import type { LayoutCatalog, ObjectLayout } from "@/features/object-layouts/layout";
import { TASK_RELATIONS } from "@/features/object-layouts/services/layout.catalog";
import {
  loadLayout as loadStoredLayout,
  loadTaskPage as loadStoredTaskPage,
  type DisplayValue,
  type ObjectPageData,
} from "@/features/object-layouts/services/layout.queries";
import { computeFormulaProperties } from "../formula/properties";
import type { FormulaResult, FormulaValue } from "../formula";
import { getCustomPropertyValues, listPropertyDefinitions } from "./properties.queries";
import { derivedPropertyKinds, isWritableKind } from "./property-values";
import { getObject, listObjectTypes } from "./registry.queries";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from" | "rpc">;

/**
 * How one property shows on the record page (U14).
 *
 *  - `editable`: a field the viewer may change (through object.set_property).
 *  - `readonly`: a plain value; the viewer may not edit this object, or the
 *    value lives on a native record this page cannot write to.
 *  - `derived`: computed by the system (formula, rollup, created/edited by and
 *    time); shown with the reason it cannot be edited.
 *  - `link`: relation and file kinds, shown as links to the other items.
 */
export type RecordFieldMode = "editable" | "readonly" | "derived" | "link";

export interface RecordLink {
  id: Uuid;
  title: string;
  href: string;
}

export interface RecordProperty {
  key: string;
  definition: PropertyDefinition;
  value: PropertyValue | null;
  mode: RecordFieldMode;
  /** Set for formula properties: the calculation, or why it failed. */
  formula: FormulaResult | null;
  /** A task's native fields as the layout preview shows them (loadTaskPage). */
  display: DisplayValue | null;
  /** Link targets for relation and file kinds; null when there are none to resolve. */
  links: RecordLink[] | null;
}

export interface RecordPerson {
  id: Uuid;
  name: string;
}

export interface RecordPageData {
  object: ObjectRecord;
  type: ObjectType;
  /** Every live type of the organization, for type labels. */
  types: ObjectType[];
  layout: ObjectLayout;
  /** The properties the viewer may see, keyed by property key, in definition order. */
  properties: Record<string, RecordProperty>;
  /** Names of the people referred to by person values. */
  people: Record<Uuid, string>;
  /** Active members, for the person fields. */
  members: RecordPerson[];
  canEdit: boolean;
  /** Whether the block editor can show this type's content. */
  editorType: "page" | "task" | null;
  /** Native task fields and related lists, when the object is a task. */
  taskPage: ObjectPageData | null;
}

export interface RecordPageDeps {
  client?: Client;
  locale?: Locale;
  timeZone?: string;
  now?: () => Date;
  loadLayout?: (typeId: Uuid, catalog: LayoutCatalog) => Promise<{ layout: ObjectLayout }>;
  loadTaskPage?: (taskId: Uuid) => Promise<ObjectPageData | null>;
}

/** Native tables a system property may be written to from the record page (same list as the writer). */
const WRITABLE_NATIVE_TABLES = new Set([
  "task", "project", "meeting", "decision", "risk", "outcome_metric", "team", "event", "crm_contact", "document",
]);

/** Types whose body the block editor can show (ObjectEditor's objectType). */
const EDITOR_TYPES = new Set(["page", "task"]);

const COLUMN = /^[a-z][a-z0-9_]*$/;

const PERSON_KINDS: readonly PropertyKind[] = ["person", "created_by", "edited_by"];

/**
 * Which of a type's definitions the viewer may see. The database answers
 * (`hidden_property_keys`); when it cannot, every restricted property is
 * hidden, so a failure never shows more.
 */
export async function visibleDefinitions(
  definitions: PropertyDefinition[],
  typeKey: string,
  client: Client,
): Promise<PropertyDefinition[]> {
  const { data, error } = await client.rpc("hidden_property_keys", { type_key: typeKey });
  if (error || !Array.isArray(data)) {
    return definitions.filter((definition) => definition.visibleToRoles === null);
  }
  const hidden = new Set((data as unknown[]).filter((key): key is string => typeof key === "string"));
  return definitions.filter((definition) => !hidden.has(definition.key));
}

/** A native column's raw value as the contract's PropertyValue. */
export function nativeValue(definition: PropertyDefinition, raw: unknown): PropertyValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (definition.kind) {
    case "person":
    case "created_by":
    case "edited_by":
      return { kind: definition.kind, value: Array.isArray(raw) ? raw.map(String) : [String(raw)] };
    case "relation": {
      const type = typeof definition.options.relationTypeKey === "string" ? definition.options.relationTypeKey : "object";
      return { kind: "relation", value: [{ id: String(raw), type }] };
    }
    case "number":
    case "currency":
    case "duration":
    case "progress":
    case "rating": {
      const number = Number(raw);
      return Number.isFinite(number) ? { kind: definition.kind, value: number } : null;
    }
    case "checkbox":
      return { kind: "checkbox", value: Boolean(raw) };
    case "date":
    case "created_time":
    case "edited_time":
      return { kind: definition.kind, value: String(raw) };
    case "text":
    case "url":
    case "email":
    case "phone":
    case "status":
    case "select":
      return { kind: definition.kind, value: String(raw) };
    default:
      return null;
  }
}

/** What a formula sees of a property: plain values, names for people, titles for links. */
export function toFormulaValue(value: PropertyValue | null, people: Record<Uuid, string>): FormulaValue {
  if (!value) return null;
  switch (value.kind) {
    case "date_range":
      return value.value.start;
    case "person":
    case "created_by":
    case "edited_by":
      return value.value.map((id) => people[id] ?? id);
    case "relation":
      return value.value.map((ref) => ref.id);
    case "file":
    case "multi_select":
      return [...value.value];
    case "location":
      return value.value.label ?? `${value.value.lat}, ${value.value.lng}`;
    default:
      return value.value;
  }
}

/** How a property is shown, given the viewer's rights and where it is stored. */
export function fieldMode(
  definition: PropertyDefinition,
  type: Pick<ObjectType, "kind" | "nativeTable">,
  canEdit: boolean,
): RecordFieldMode {
  if (definition.kind === "relation" || definition.kind === "file") return "link";
  if (derivedPropertyKinds.includes(definition.kind)) return "derived";
  if (!canEdit || !isWritableKind(definition.kind) || definition.kind === "location") return "readonly";
  if (definition.systemColumn) {
    const table = type.nativeTable;
    if (!table || !WRITABLE_NATIVE_TABLES.has(table) || !COLUMN.test(definition.systemColumn)) return "readonly";
  }
  return "editable";
}

/**
 * Everything the record page shows for one object, read as the viewer: the
 * object and its type, the property definitions the viewer may see (in
 * order), their values (custom ones from property_value, native ones from the
 * record's own table), formulas calculated here, rollups from their stored
 * values, and the type's layout. Null when the object does not exist or the
 * viewer cannot see it; the two are deliberately indistinguishable.
 */
export async function loadRecordPage(objectId: Uuid, deps: RecordPageDeps = {}): Promise<RecordPageData | null> {
  const client = deps.client ?? (await createSupabaseServerClient());
  const locale = deps.locale ?? "en";
  const loadLayout = deps.loadLayout ?? loadStoredLayout;
  const loadTaskPage = deps.loadTaskPage ?? loadStoredTaskPage;

  const object = await getObject(objectId, client);
  if (!object) return null;
  const types = await listObjectTypes(object.organizationId, client);
  const type = types.find((candidate) => candidate.key === object.type);
  if (!type) return null;

  const [allDefinitions, canEditAnswer, customValues, taskPage] = await Promise.all([
    listPropertyDefinitions(type.id, client),
    client.rpc("can", { object_id: object.id, capability: "edit_content" }),
    getCustomPropertyValues(object.id, client),
    type.key === "task" ? loadTaskPage(object.id) : Promise.resolve(null),
  ]);
  const canEdit = !canEditAnswer.error && canEditAnswer.data === true;
  const definitions = await visibleDefinitions(allDefinitions, type.key, client);

  // Native columns the viewer may see, read from the record's own table.
  const nativeColumns = definitions
    .filter((definition) => definition.systemColumn && COLUMN.test(definition.systemColumn))
    .map((definition) => definition.systemColumn as string);
  let nativeRow: Record<string, unknown> = {};
  if (type.nativeTable && nativeColumns.length > 0) {
    const { data } = await client
      .from(type.nativeTable)
      .select([...new Set(nativeColumns)].join(", "))
      .eq("id", object.id)
      .maybeSingle();
    nativeRow = (data as unknown as Record<string, unknown> | null) ?? {};
  }

  const values: Record<string, PropertyValue | null> = {};
  for (const definition of definitions) {
    values[definition.key] = definition.systemColumn
      ? nativeValue(definition, nativeRow[definition.systemColumn])
      : (customValues[definition.key] ?? null);
  }

  // Names for every person referred to, and the members a person field offers.
  const personIds = new Set<Uuid>();
  for (const value of Object.values(values)) {
    if (value && PERSON_KINDS.includes(value.kind)) for (const id of value.value as Uuid[]) personIds.add(id);
  }
  const fileIds = new Set<Uuid>();
  const relationIds = new Set<Uuid>();
  for (const value of Object.values(values)) {
    if (value?.kind === "file") for (const id of value.value) fileIds.add(id);
    if (value?.kind === "relation") for (const ref of value.value) relationIds.add(ref.id);
  }

  const [membersAnswer, filesAnswer, relatedAnswer] = await Promise.all([
    client
      .from("organization_membership")
      .select("user_id, user_profile!inner(full_name)")
      .eq("organization_id", object.organizationId)
      .eq("status", "active")
      .limit(1000),
    fileIds.size ? client.from("document").select("id, title").in("id", [...fileIds]) : Promise.resolve({ data: [] }),
    relationIds.size ? client.from("object").select("id, title").in("id", [...relationIds]) : Promise.resolve({ data: [] }),
  ]);
  const members: RecordPerson[] = ((membersAnswer.data ?? []) as { user_id: string; user_profile: unknown }[])
    .map((row) => {
      const profile = Array.isArray(row.user_profile) ? row.user_profile[0] : row.user_profile;
      return { id: row.user_id, name: ((profile as { full_name?: string | null } | null)?.full_name ?? "").trim() };
    })
    .filter((person) => person.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const people: Record<Uuid, string> = {};
  for (const member of members) people[member.id] = member.name;
  const missing = [...personIds].filter((id) => !people[id]);
  if (missing.length > 0) {
    const { data } = await client.from("user_profile").select("id, full_name").in("id", missing);
    for (const row of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (row.full_name) people[row.id] = row.full_name;
    }
  }
  const fileTitles = new Map(((filesAnswer.data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
  const relatedTitles = new Map(
    ((relatedAnswer.data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]),
  );

  // Formulas, calculated from what the viewer may see; a formula can never
  // reveal a private property because hidden ones are not in `values`.
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;
  const today =
    calendarDateInZone((deps.now ?? (() => new Date()))(), timeZone) ?? new Date().toISOString().slice(0, 10);
  const formulaInputs: Record<string, FormulaValue> = {};
  for (const [key, value] of Object.entries(values)) formulaInputs[key] = toFormulaValue(value, people);
  formulaInputs.title = object.title;
  const formulas = computeFormulaProperties({ definitions, values: formulaInputs, today, locale });

  const properties: Record<string, RecordProperty> = {};
  // A layout may name `title` for a type that has no title property: the
  // object's own title stands in, read-only, ahead of everything else.
  if (!definitions.some((definition) => definition.key === "title")) {
    properties.title = {
      key: "title",
      definition: {
        id: "title",
        typeId: type.id,
        key: "title",
        name: { en: "Title", fr: "Titre" },
        kind: "text",
        options: {},
        systemColumn: null,
        visibleToRoles: null,
        position: 0,
      },
      value: { kind: "text", value: object.title },
      mode: "readonly",
      formula: null,
      display: null,
      links: null,
    };
  }
  for (const definition of definitions) {
    const formula = definition.kind === "formula" ? (formulas[definition.key] ?? null) : null;
    const value =
      definition.kind === "formula"
        ? ({ kind: "formula", value: formula?.ok ? formula.value : null } satisfies PropertyValue)
        : values[definition.key];
    let links: RecordLink[] | null = null;
    if (value?.kind === "file") {
      links = value.value.map((id) => ({ id, title: fileTitles.get(id) ?? id, href: `/documents/${id}` }));
    } else if (value?.kind === "relation") {
      links = value.value
        .filter((ref) => relatedTitles.has(ref.id))
        .map((ref) => ({ id: ref.id, title: relatedTitles.get(ref.id) ?? ref.id, href: `/objects/${ref.id}` }));
    }
    properties[definition.key] = {
      key: definition.key,
      definition,
      value,
      mode: fieldMode(definition, type, canEdit),
      formula,
      display: taskPage?.values[definition.key] ?? null,
      links,
    };
  }

  const catalog: LayoutCatalog = {
    properties: Object.keys(properties),
    relations: type.key === "task" ? [...TASK_RELATIONS] : [],
  };
  const { layout } = await loadLayout(type.id, catalog);

  return {
    object,
    type,
    types,
    layout,
    properties,
    people,
    members,
    canEdit,
    editorType: EDITOR_TYPES.has(type.key) ? (type.key as "page" | "task") : null,
    taskPage,
  };
}
