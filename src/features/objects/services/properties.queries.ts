import type { PropertyDefinition, PropertyValue, Uuid } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PROPERTY_DEFINITION_COLUMNS,
  decodePropertyValue,
  encodePropertyValue,
  isWritableKind,
  toPropertyDefinition,
  type PropertyDefinitionRow,
  type PropertyValueColumns,
} from "./property-values";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/** The live properties of one type, system properties included, in order. */
export async function listPropertyDefinitions(
  typeId: Uuid,
  client?: Client,
): Promise<PropertyDefinition[]> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("property_definition")
    .select(PROPERTY_DEFINITION_COLUMNS)
    .eq("type_id", typeId)
    .is("archived_at", null)
    .order("position")
    .order("key");
  if (error || !data) return [];
  return (data as PropertyDefinitionRow[]).map(toPropertyDefinition);
}

/**
 * The custom values of one object that the viewer may see, keyed by property
 * key. Private properties the viewer's role cannot see are simply absent.
 */
export async function getCustomPropertyValues(
  objectId: Uuid,
  client?: Client,
): Promise<Record<string, PropertyValue>> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("property_value")
    .select(
      "value_text, value_number, value_date, value_date_end, value_bool, value_uuids, value_json, property:property_id(key, kind)",
    )
    .eq("object_id", objectId);
  if (error || !data) return {};
  const values: Record<string, PropertyValue> = {};
  for (const row of data as (Partial<PropertyValueColumns> & {
    property: { key: string; kind: PropertyDefinition["kind"] } | { key: string; kind: PropertyDefinition["kind"] }[] | null;
  })[]) {
    const property = Array.isArray(row.property) ? row.property[0] : row.property;
    if (!property) continue;
    const value = decodePropertyValue(property.kind, row);
    if (value) values[property.key] = value;
  }
  return values;
}

export type SetPropertyValueResult =
  | { ok: true }
  | { ok: false; reason: "not_writable" | "forbidden_or_failed" };

/**
 * Writes one custom value (null clears it). RLS decides whether the viewer may:
 * edit_content on the object and the property's roles.
 */
export async function setCustomPropertyValue(
  objectId: Uuid,
  property: Pick<PropertyDefinition, "id" | "kind" | "systemColumn">,
  value: PropertyValue | null,
  client?: Client,
): Promise<SetPropertyValueResult> {
  if (property.systemColumn || !isWritableKind(property.kind)) {
    return { ok: false, reason: "not_writable" };
  }
  const supabase = client ?? (await createSupabaseServerClient());
  if (value === null) {
    const { error } = await supabase
      .from("property_value")
      .delete()
      .eq("object_id", objectId)
      .eq("property_id", property.id);
    return error ? { ok: false, reason: "forbidden_or_failed" } : { ok: true };
  }
  if (value.kind !== property.kind) return { ok: false, reason: "not_writable" };
  const { error } = await supabase
    .from("property_value")
    .upsert({ object_id: objectId, property_id: property.id, ...encodePropertyValue(value) });
  return error ? { ok: false, reason: "forbidden_or_failed" } : { ok: true };
}
