import type { Change, PropertyKind, Uuid } from "@/lib/objects/contracts";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  decodePropertyValue,
  encodePropertyValue,
  isWritableKind,
} from "@/features/objects/services/property-values";
import type { ObjectWriter } from "./registry";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

interface ResolvedProperty {
  objectId: Uuid;
  organizationId: Uuid;
  nativeTable: string | null;
  propertyId: Uuid;
  kind: PropertyKind;
  systemColumn: string | null;
}

/** Native tables a system property may be written to through this path. */
const WRITABLE_NATIVE_TABLES = new Set([
  "task", "project", "meeting", "decision", "risk", "outcome_metric", "team", "event", "crm_contact", "document",
]);

/** Native tables whose rows are archived, not deleted, when a creation is undone. */
const ARCHIVABLE_NATIVE_TABLES = new Set(["task"]);

const COLUMN = /^[a-z][a-z0-9_]*$/;

export class ObjectWriteError extends Error {}

/**
 * Applies and reads property values through the caller's own client, so RLS
 * and the native tables' triggers (scope checks, audit) decide exactly as
 * they do for the existing screens. System properties are written to their
 * native column; custom ones to property_value.
 */
export function createSupabaseObjectWriter(client: Client): ObjectWriter {
  const cache = new Map<string, Promise<ResolvedProperty>>();

  const resolve = (objectId: Uuid, key: string): Promise<ResolvedProperty> => {
    const cacheKey = `${objectId}:${key}`;
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const { data: object } = await client
          .from("object")
          .select("id, organization_id, type_id, object_type!object_type_id_organization_id_fkey(native_table)")
          .eq("id", objectId)
          .maybeSingle();
        if (!object) throw new ObjectWriteError("not_found");
        const type = (object as { object_type: { native_table: string | null } | { native_table: string | null }[] | null }).object_type;
        const nativeTable = (Array.isArray(type) ? type[0] : type)?.native_table ?? null;
        const { data: property } = await client
          .from("property_definition")
          .select("id, kind, system_column")
          .eq("type_id", (object as { type_id: Uuid }).type_id)
          .eq("key", key)
          .is("archived_at", null)
          .maybeSingle();
        if (!property) throw new ObjectWriteError("unknown_property");
        return {
          objectId,
          organizationId: (object as { organization_id: Uuid }).organization_id,
          nativeTable,
          propertyId: (property as { id: Uuid }).id,
          kind: (property as { kind: PropertyKind }).kind,
          systemColumn: (property as { system_column: string | null }).system_column,
        };
      })();
      cache.set(cacheKey, pending);
    }
    return pending;
  };

  const nativeTarget = (property: ResolvedProperty) => {
    const table = property.nativeTable;
    const column = property.systemColumn;
    if (!table || !column || !WRITABLE_NATIVE_TABLES.has(table) || !COLUMN.test(column)) {
      throw new ObjectWriteError("not_writable");
    }
    if (["created_by", "created_time", "edited_by", "edited_time"].includes(property.kind)) {
      throw new ObjectWriteError("not_writable");
    }
    return { table, column };
  };

  async function writeUpdate(change: Change & { kind: "update" }) {
    const property = await resolve(change.object.id, change.property);
    if (property.systemColumn) {
      const { table, column } = nativeTarget(property);
      const { data, error } = await client
        .from(table)
        .update({ [column]: change.after ?? null })
        .eq("id", change.object.id)
        .select("id");
      // RLS hides a row the caller may not change: zero rows is a refusal.
      if (error || !data || data.length === 0) throw new ObjectWriteError(error?.message ?? "forbidden");
      return;
    }
    if (!isWritableKind(property.kind)) throw new ObjectWriteError("not_writable");
    if (change.after === null || change.after === undefined) {
      const { error } = await client
        .from("property_value")
        .delete()
        .eq("object_id", change.object.id)
        .eq("property_id", property.propertyId);
      if (error) throw new ObjectWriteError(error.message);
      return;
    }
    const columns = encodePropertyValue({ kind: property.kind, value: change.after } as never);
    const { error } = await client
      .from("property_value")
      .upsert({ object_id: change.object.id, property_id: property.propertyId, ...columns });
    if (error) throw new ObjectWriteError(error.message);
  }

  async function writeLink(change: Change & { kind: "link" | "unlink" }) {
    const { relation } = change;
    const { data: from } = await client
      .from("object")
      .select("organization_id")
      .eq("id", relation.from.id)
      .maybeSingle();
    if (!from) throw new ObjectWriteError("not_found");
    const organizationId = (from as { organization_id: Uuid }).organization_id;
    const { data: type } = await client
      .from("relation_type")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("key", relation.relationTypeKey)
      .maybeSingle();
    if (!type) throw new ObjectWriteError("unknown_relation");
    const relationTypeId = (type as { id: Uuid }).id;
    if (change.kind === "link") {
      const { error } = await client.from("object_relation").insert({
        organization_id: organizationId,
        from_id: relation.from.id,
        to_id: relation.to.id,
        relation_type_id: relationTypeId,
      });
      if (error) throw new ObjectWriteError(error.message);
    } else {
      const { data, error } = await client
        .from("object_relation")
        .delete()
        .eq("from_id", relation.from.id)
        .eq("to_id", relation.to.id)
        .eq("relation_type_id", relationTypeId)
        .select("id");
      if (error || !data || data.length === 0) throw new ObjectWriteError(error?.message ?? "forbidden");
    }
  }

  /**
   * A create or delete change on a record that archives rather than deletes:
   * undoing a creation archives the row (the bytes and history stay), and
   * undoing that undo restores it. Only tables with an `archived_at` column
   * the screens already honour are reachable this way.
   */
  async function writeArchive(change: Change & { kind: "create" | "delete" }) {
    const { data: object } = await client
      .from("object")
      .select("id, object_type!object_type_id_organization_id_fkey(native_table)")
      .eq("id", change.object.id)
      .maybeSingle();
    if (!object) throw new ObjectWriteError("not_found");
    const type = (object as { object_type: { native_table: string | null } | { native_table: string | null }[] | null }).object_type;
    const table = (Array.isArray(type) ? type[0] : type)?.native_table ?? null;
    if (!table || !ARCHIVABLE_NATIVE_TABLES.has(table)) throw new ObjectWriteError("create_delete_not_supported");
    const { data, error } = await client
      .from(table)
      .update({ archived_at: change.kind === "delete" ? new Date().toISOString() : null })
      .eq("id", change.object.id)
      .select("id");
    if (error || !data || data.length === 0) throw new ObjectWriteError(error?.message ?? "forbidden");
  }

  return {
    async changedSince(object, since) {
      if (object.type !== "task" && object.type !== "project") return false;
      const { data } = await client.from(object.type).select("updated_at").eq("id", object.id).maybeSingle();
      const updated = (data as { updated_at: string } | null)?.updated_at;
      return typeof updated === "string" && new Date(updated).getTime() > new Date(since).getTime();
    },
    async apply(changes) {
      for (const change of changes) {
        if (change.kind === "update") await writeUpdate(change);
        else if (change.kind === "link" || change.kind === "unlink") await writeLink(change);
        else await writeArchive(change);
      }
    },
    async read(change) {
      const property = await resolve(change.object.id, change.property);
      if (property.systemColumn) {
        const { table, column } = nativeTarget(property);
        const { data, error } = await client.from(table).select(column).eq("id", change.object.id).maybeSingle();
        if (error || !data) throw new ObjectWriteError("not_found");
        return (data as unknown as Record<string, unknown>)[column] ?? null;
      }
      const { data } = await client
        .from("property_value")
        .select("value_text, value_number, value_date, value_date_end, value_bool, value_uuids, value_json")
        .eq("object_id", change.object.id)
        .eq("property_id", property.propertyId)
        .maybeSingle();
      if (!data) return null;
      return decodePropertyValue(property.kind, data)?.value ?? null;
    },
  };
}
