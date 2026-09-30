import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ObjectRef } from "@/lib/objects/contracts";

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface VersionSummary {
  id: string;
  kind: "auto" | "manual" | "restore";
  label: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface TrashEntry {
  objectId: string;
  objectType: string;
  title: string;
  deletedAt: string;
  deletedByName: string | null;
  purgeAfter: string;
}

async function names(db: Db, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await db.from("user_profile").select("id, full_name").in("id", unique);
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((row) => [row.id, row.full_name]));
}

/** An object's versions, newest first, as the reader may see them (RLS). */
export async function listObjectVersions(object: ObjectRef, limit = 100): Promise<VersionSummary[]> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_version")
    .select("id, kind, label, created_at, created_by")
    .eq("object_id", object.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as {
    id: string;
    kind: VersionSummary["kind"];
    label: string | null;
    created_at: string;
    created_by: string | null;
  }[];
  const people = await names(db, rows.map((row) => row.created_by ?? ""));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    createdAt: row.created_at,
    createdByName: row.created_by ? people.get(row.created_by) ?? null : null,
  }));
}

/** What the reader may see in the trash: still restorable, newest first. */
export async function listTrash(): Promise<TrashEntry[]> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_trash")
    .select("object_id, object_type, title, deleted_at, deleted_by, purge_after")
    .is("restored_at", null)
    .is("purged_at", null)
    .order("deleted_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as {
    object_id: string;
    object_type: string;
    title: string;
    deleted_at: string;
    deleted_by: string | null;
    purge_after: string;
  }[];
  const people = await names(db, rows.map((row) => row.deleted_by ?? ""));
  return rows.map((row) => ({
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    deletedAt: row.deleted_at,
    deletedByName: row.deleted_by ? people.get(row.deleted_by) ?? null : null,
    purgeAfter: row.purge_after,
  }));
}

/** Whether the object is in the trash (restorable) right now. */
export async function isInTrash(objectId: string): Promise<boolean> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_trash")
    .select("id")
    .eq("object_id", objectId)
    .is("restored_at", null)
    .is("purged_at", null)
    .limit(1);
  return (data ?? []).length > 0;
}
