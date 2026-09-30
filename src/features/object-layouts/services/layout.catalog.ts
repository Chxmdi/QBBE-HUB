import { createSupabaseServerClient } from "@/lib/supabase/server";
import { taskSystemProperties } from "@/lib/objects/stubs";
import type { LayoutCatalog } from "../layout";

/** Related lists a task page can show. */
export const TASK_RELATIONS = ["project", "blocked_by", "blocking"] as const;

/**
 * What a type's page can show. Tasks use their system properties
 * (`taskSystemProperties`) and native links; other types read their
 * property definitions once S1's M2 lands (until then, only the title).
 */
export async function layoutCatalog(typeKey: string): Promise<LayoutCatalog> {
  if (typeKey === "task") {
    return { properties: Object.keys(taskSystemProperties), relations: [...TASK_RELATIONS] };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("property_definition")
    .select("key, position, object_type!inner(key)")
    .eq("object_type.key", typeKey)
    .is("archived_at", null)
    .order("position");
  const keys = error ? [] : ((data ?? []) as { key: string }[]).map((row) => row.key);
  return { properties: keys.includes("title") ? keys : ["title", ...keys], relations: [] };
}
