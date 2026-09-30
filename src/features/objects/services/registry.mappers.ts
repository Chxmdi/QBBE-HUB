import type { LensKind, ObjectRecord, ObjectType, Uuid } from "@/lib/objects/contracts";

/** `object_type` as PostgREST returns it. */
export interface ObjectTypeRow {
  id: Uuid;
  key: string;
  name_en: string;
  name_fr: string;
  icon: string | null;
  kind: "native" | "custom";
  native_table: string | null;
  default_lens: LensKind;
  default_template_id: Uuid | null;
}

/** `object` joined to its type's key, as PostgREST returns it. */
export interface ObjectRow {
  id: Uuid;
  organization_id: Uuid;
  space_id: Uuid | null;
  parent_object_id: Uuid | null;
  title: string;
  icon: string | null;
  cover: string | null;
  owner_id: Uuid | null;
  created_by: Uuid | null;
  created_at: string;
  updated_by: Uuid | null;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  object_type: { key: string } | { key: string }[] | null;
}

export const OBJECT_TYPE_COLUMNS =
  "id, key, name_en, name_fr, icon, kind, native_table, default_lens, default_template_id";

export const OBJECT_COLUMNS =
  "id, organization_id, space_id, parent_object_id, title, icon, cover, owner_id, created_by, created_at, updated_by, updated_at, archived_at, deleted_at, object_type:type_id(key)";

export function toObjectType(row: ObjectTypeRow): ObjectType {
  return {
    id: row.id,
    key: row.key,
    name: { en: row.name_en, fr: row.name_fr },
    icon: row.icon,
    kind: row.kind,
    nativeTable: row.native_table,
    defaultLens: row.default_lens,
    defaultTemplateId: row.default_template_id,
  };
}

/** Null when the row came back without its type (it cannot be typed). */
export function toObjectRecord(row: ObjectRow): ObjectRecord | null {
  const type = Array.isArray(row.object_type) ? row.object_type[0] : row.object_type;
  if (!type?.key) return null;
  return {
    id: row.id,
    type: type.key,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    parentObjectId: row.parent_object_id,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}
