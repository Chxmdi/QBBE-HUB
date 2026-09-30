import type { SupabaseClient } from "@supabase/supabase-js";
import { SOURCE_TABLES, isTaskSourceType, sourceHref, sourceTitle, type TaskSourceType } from "./sources";

export interface ResolvedTaskSource {
  type: TaskSourceType;
  id: string | null;
  /** The source's own title, or null when there is none or it cannot be read. */
  title: string | null;
  href: string | null;
  /** False when the task names a source the reader cannot see. */
  readable: boolean;
}

/**
 * The link back from a task to where it came from (M7b), resolved through the
 * reader's own RLS: a task can be visible to someone who cannot see the
 * meeting or message it came from, and then they learn the kind of source
 * and nothing else.
 */
export async function resolveTaskSource(
  db: SupabaseClient,
  taskId: string,
): Promise<ResolvedTaskSource | null> {
  const { data: task } = await db
    .from("task")
    .select("source_type, source_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || !isTaskSourceType(task.source_type)) return null;
  const type = task.source_type;
  const id = (task.source_id as string | null) ?? null;
  const spec = SOURCE_TABLES[type];
  if (!id || !spec) {
    return { type, id, title: null, href: sourceHref(type, id), readable: true };
  }
  const columns = ["id", spec.title, ...(spec.extra ?? [])].join(", ");
  const { data: row } = await db.from(spec.table).select(columns).eq("id", id).maybeSingle();
  if (!row) return { type, id, title: null, href: null, readable: false };
  const record = row as unknown as Record<string, unknown>;
  return {
    type,
    id,
    title: sourceTitle(record[spec.title]),
    href: sourceHref(type, id, record),
    readable: true,
  };
}
