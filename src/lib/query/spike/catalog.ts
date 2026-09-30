// W0-8 spike: the allow-list the compiler resolves names against.
//
// A property is either a *system* property, stored in a column of
// wos_spike.object, or a *custom* property, stored in property_value (or
// object_relation for relations). Only system properties map to SQL
// identifiers, and those identifiers are the constants in SYSTEM_PROPERTIES
// below: nothing read from the database or from a spec ever becomes SQL text.
// Custom properties reach SQL only as their id, bound as a parameter.

import type { PropertyKind } from "./spec";

/** The only columns of wos_spike.object the compiler may reference. */
export const SYSTEM_COLUMNS = {
  title: "title",
  space: "space_id",
  owner: "owner_id",
  created_at: "created_at",
  updated_at: "updated_at",
} as const;
export type SystemKey = keyof typeof SYSTEM_COLUMNS;

export interface Option {
  id: string;
  en: string;
  fr: string;
}

interface BaseProperty {
  key: string;
  kind: PropertyKind;
  name: { en: string; fr: string };
}
export interface SystemProperty extends BaseProperty {
  source: "system";
  column: SystemKey;
  /** timestamptz columns compare in the viewer's time zone; date columns do not. */
  timestamp?: boolean;
  /** select-like columns whose values are ids (space), not a fixed option list. */
  uuidValues?: boolean;
}
export interface CustomProperty extends BaseProperty {
  source: "custom";
  id: string;
  options: Option[];
  targetType?: string;
}
export type Property = SystemProperty | CustomProperty;

export interface ObjectType {
  key: string;
  id: string;
  properties: Map<string, Property>;
}
export type Catalog = Map<string, ObjectType>;

export const SYSTEM_PROPERTIES: SystemProperty[] = [
  { source: "system", key: "title", column: "title", kind: "text", name: { en: "Title", fr: "Titre" } },
  { source: "system", key: "space", column: "space", kind: "select", uuidValues: true, name: { en: "Space", fr: "Espace" } },
  { source: "system", key: "owner", column: "owner", kind: "person", name: { en: "Owner", fr: "Responsable" } },
  { source: "system", key: "created_at", column: "created_at", kind: "date", timestamp: true, name: { en: "Created", fr: "Créé" } },
  { source: "system", key: "updated_at", column: "updated_at", kind: "date", timestamp: true, name: { en: "Updated", fr: "Modifié" } },
];

export interface TypeRow {
  id: string;
  key: string;
}
export interface PropertyRow {
  id: string;
  type_id: string;
  key: string;
  name_en: string;
  name_fr: string;
  kind: PropertyKind;
  options: Option[] | null;
  target_type_id: string | null;
}

/** Build the catalog from the rows the viewer can read (RLS applies to these too). */
export function buildCatalog(types: TypeRow[], properties: PropertyRow[]): Catalog {
  const keyById = new Map(types.map((t) => [t.id, t.key]));
  const catalog: Catalog = new Map();
  for (const t of types) {
    const props = new Map<string, Property>(SYSTEM_PROPERTIES.map((p) => [p.key, p]));
    for (const row of properties.filter((p) => p.type_id === t.id)) {
      // A custom property can never shadow a system one.
      if (props.has(row.key)) continue;
      props.set(row.key, {
        source: "custom",
        id: row.id,
        key: row.key,
        kind: row.kind,
        name: { en: row.name_en, fr: row.name_fr },
        options: row.options ?? [],
        targetType: row.target_type_id ? keyById.get(row.target_type_id) : undefined,
      });
    }
    catalog.set(t.key, { key: t.key, id: t.id, properties: props });
  }
  return catalog;
}
