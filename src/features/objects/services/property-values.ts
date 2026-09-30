import type {
  PropertyDefinition,
  PropertyKind,
  PropertyValue,
  Uuid,
} from "@/lib/objects/contracts";

/** The typed columns of one `property_value` row. */
export interface PropertyValueColumns {
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_date_end: string | null;
  value_bool: boolean | null;
  value_uuids: Uuid[] | null;
  value_json: unknown;
}

const EMPTY: PropertyValueColumns = {
  value_text: null,
  value_number: null,
  value_date: null,
  value_date_end: null,
  value_bool: null,
  value_uuids: null,
  value_json: null,
};

/**
 * Kinds whose values are computed or stored elsewhere, so nobody writes them
 * into property_value by hand (same list as app.can_write_property).
 */
export const derivedPropertyKinds: readonly PropertyKind[] = [
  "rollup",
  "formula",
  "relation",
  "created_by",
  "created_time",
  "edited_by",
  "edited_time",
];

export function isWritableKind(kind: PropertyKind): boolean {
  return !derivedPropertyKinds.includes(kind);
}

/** `property_definition` as PostgREST returns it. */
export interface PropertyDefinitionRow {
  id: Uuid;
  type_id: Uuid;
  key: string;
  name_en: string;
  name_fr: string;
  kind: PropertyKind;
  options: PropertyDefinition["options"] | null;
  system_column: string | null;
  visible_to_roles: string[] | null;
  position: number;
}

export const PROPERTY_DEFINITION_COLUMNS =
  "id, type_id, key, name_en, name_fr, kind, options, system_column, visible_to_roles, position";

export function toPropertyDefinition(row: PropertyDefinitionRow): PropertyDefinition {
  return {
    id: row.id,
    typeId: row.type_id,
    key: row.key,
    name: { en: row.name_en, fr: row.name_fr },
    kind: row.kind,
    options: row.options ?? {},
    systemColumn: row.system_column,
    visibleToRoles: row.visible_to_roles,
    position: row.position,
  };
}

/**
 * The columns a value is stored in. Throws for a value whose kind is not
 * stored in property_value (relations, system-computed kinds).
 */
export function encodePropertyValue(value: PropertyValue): PropertyValueColumns {
  switch (value.kind) {
    case "text":
    case "url":
    case "email":
    case "phone":
    case "status":
    case "select":
      return { ...EMPTY, value_text: value.value };
    case "number":
    case "currency":
    case "duration":
    case "progress":
    case "rating":
      if (!Number.isFinite(value.value)) throw new Error("A number value must be finite.");
      return { ...EMPTY, value_number: value.value };
    case "checkbox":
      return { ...EMPTY, value_bool: value.value };
    case "date":
      return { ...EMPTY, value_date: value.value };
    case "date_range":
      return { ...EMPTY, value_date: value.value.start, value_date_end: value.value.end };
    case "multi_select":
      return { ...EMPTY, value_json: [...value.value] };
    case "person":
    case "file":
      return { ...EMPTY, value_uuids: [...value.value] };
    case "location":
      return { ...EMPTY, value_json: { ...value.value } };
    default:
      throw new Error(`Values of kind ${value.kind} are not stored in property_value.`);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Reads a row back into the contract's shape; null when the row is empty. */
export function decodePropertyValue(
  kind: PropertyKind,
  row: Partial<PropertyValueColumns>,
): PropertyValue | null {
  switch (kind) {
    case "text":
    case "url":
    case "email":
    case "phone":
    case "status":
    case "select":
      return row.value_text == null ? null : { kind, value: row.value_text };
    case "number":
    case "currency":
    case "duration":
    case "progress":
    case "rating":
      return row.value_number == null ? null : { kind, value: Number(row.value_number) };
    case "rollup":
      return { kind, value: row.value_number == null ? null : Number(row.value_number) };
    case "checkbox":
      return row.value_bool == null ? null : { kind, value: row.value_bool };
    case "date":
      return row.value_date == null ? null : { kind, value: row.value_date };
    case "date_range":
      return row.value_date == null
        ? null
        : { kind, value: { start: row.value_date, end: row.value_date_end ?? null } };
    case "multi_select":
      return isStringArray(row.value_json) ? { kind, value: row.value_json } : null;
    case "person":
    case "file":
      return row.value_uuids == null ? null : { kind, value: row.value_uuids };
    case "location": {
      const json = row.value_json as { lat?: unknown; lng?: unknown; label?: unknown } | null;
      if (!json || typeof json.lat !== "number" || typeof json.lng !== "number") return null;
      return {
        kind,
        value: { lat: json.lat, lng: json.lng, label: typeof json.label === "string" ? json.label : null },
      };
    }
    case "formula": {
      const json = row.value_json;
      if (json === null || json === undefined) return { kind, value: null };
      return typeof json === "string" || typeof json === "number" || typeof json === "boolean"
        ? { kind, value: json }
        : null;
    }
    default:
      return null;
  }
}
