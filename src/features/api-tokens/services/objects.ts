import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { taskSystemProperties } from "@/lib/objects/stubs";
import { ApiError, canAs, type ApiIdentity } from "./api-handler";

/**
 * Objects, properties and relations for /api/v1 (V2-8), read as the token's
 * person. Objects come from the object registry (`object`, M1a); a record the
 * person cannot view is reported as not found, exactly like one that does not
 * exist, so the API never confirms what someone may not see.
 */

export interface ApiObject {
  id: string;
  type: string;
  title: string;
  ownerId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface ObjectRow {
  id: string;
  type: string;
  title: string;
  owner_id: string | null;
  parent_object_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

const toApi = (row: ObjectRow): ApiObject => ({
  id: row.id,
  type: row.type,
  title: row.title,
  ownerId: row.owner_id,
  parentId: row.parent_object_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archivedAt: row.archived_at,
});

export const listQuerySchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

/** An opaque cursor: the last row's updated time and id. */
export function encodeCursor(row: { updated_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.updated_at, row.id])).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    if (Number.isNaN(new Date(updatedAt).getTime()) || !z.string().uuid().safeParse(id).success) throw new Error();
    return { updatedAt, id };
  } catch {
    throw new ApiError(400, "invalid_cursor", "The cursor is not one this API gave out.");
  }
}

export async function listObjects(db: SupabaseClient, identity: ApiIdentity, searchParams: URLSearchParams) {
  const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) throw new ApiError(400, "invalid_query", parsed.error.issues[0]?.message ?? "Invalid query.");
  const after = decodeCursor(parsed.data.cursor);
  const { data, error } = await db.rpc("api_list_objects", {
    p_user: identity.userId,
    p_organization: identity.organizationId,
    p_type: parsed.data.type ?? null,
    p_limit: parsed.data.limit + 1,
    p_after_updated: after?.updatedAt ?? null,
    p_after_id: after?.id ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ObjectRow[];
  const page = rows.slice(0, parsed.data.limit);
  return {
    data: page.map(toApi),
    nextCursor: rows.length > parsed.data.limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

const uuid = z.string().uuid();

/** One object the person may view, or a 404. */
export async function getObject(db: SupabaseClient, identity: ApiIdentity, id: string): Promise<ApiObject> {
  if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found", "No such object.");
  const { data } = await db
    .from("object")
    .select("id, title, owner_id, parent_object_id, created_at, updated_at, archived_at, object_type!inner(key)")
    .eq("id", id)
    .eq("organization_id", identity.organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  const row = data as (Omit<ObjectRow, "type"> & { object_type: { key: string } }) | null;
  if (!row || !(await canAs(db, identity, id, "view"))) throw new ApiError(404, "not_found", "No such object.");
  return toApi({ ...row, type: row.object_type.key });
}

/**
 * The object's properties. Every object has its registry fields; a task also
 * has its system properties (plan A2), read from the task itself.
 */
export async function objectProperties(db: SupabaseClient, identity: ApiIdentity, id: string) {
  const object = await getObject(db, identity, id);
  const properties: Record<string, unknown> = {
    title: object.title,
    owner: object.ownerId,
    created_time: object.createdAt,
    edited_time: object.updatedAt,
  };
  if (object.type === "task") {
    const columns = Object.values(taskSystemProperties).map((property) => property.column);
    const { data } = await db.from("task").select(columns.join(", ")).eq("id", id).maybeSingle();
    const task = (data ?? {}) as unknown as Record<string, unknown>;
    for (const [key, property] of Object.entries(taskSystemProperties)) {
      if (property.column in task) properties[key] = task[property.column] ?? null;
    }
  }
  return { object: { id: object.id, type: object.type }, properties };
}

/**
 * The object's relations the person may see: its parent and children in the
 * registry, and for a task its project. Each end is checked with the access
 * check, so a relation to something hidden is left out.
 */
export async function objectRelations(db: SupabaseClient, identity: ApiIdentity, id: string) {
  const object = await getObject(db, identity, id);
  const relations: { type: string; direction: "outgoing" | "incoming"; object: { id: string; type: string } }[] = [];

  const visible = async (ref: { id: string; type: string }) => (await canAs(db, identity, ref.id, "view")) ? ref : null;
  if (object.parentId) {
    const { data } = await db.from("object").select("id, object_type!inner(key)").eq("id", object.parentId).maybeSingle();
    const parent = data as { id: string; object_type: { key: string } } | null;
    const ref = parent ? await visible({ id: parent.id, type: parent.object_type.key }) : null;
    if (ref) relations.push({ type: "contains", direction: "incoming", object: ref });
  }
  const { data: children } = await db
    .from("object")
    .select("id, object_type!inner(key)")
    .eq("parent_object_id", id)
    .is("deleted_at", null)
    .limit(100);
  for (const child of (children ?? []) as unknown as { id: string; object_type: { key: string } }[]) {
    const ref = await visible({ id: child.id, type: child.object_type.key });
    if (ref) relations.push({ type: "contains", direction: "outgoing", object: ref });
  }
  if (object.type === "task") {
    const { data } = await db.from("task").select("project_id").eq("id", id).maybeSingle();
    const projectId = (data as { project_id: string | null } | null)?.project_id;
    const ref = projectId ? await visible({ id: projectId, type: "project" }) : null;
    if (ref) relations.push({ type: "contains", direction: "incoming", object: ref });
  }
  return { object: { id: object.id, type: object.type }, relations };
}
