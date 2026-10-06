import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ObjectRef } from "@/lib/objects/contracts";
import type { ContentSnapshot, ObjectContentAdapter, PropertySnapshot } from "../content";

/**
 * Tasks as versioned objects, until the block editor (S3) and the property
 * layer (S1, M2) take over. The content is the description as one block, and
 * the properties are the task's own editable fields, keyed as in
 * `taskSystemProperties` (src/lib/objects/stubs.ts). Every read and write
 * runs as the signed-in person, so the task's RLS and triggers still decide.
 */
const COLUMNS: Record<string, string> = {
  title: "title",
  status: "status",
  priority: "priority",
  start: "start_at",
  due: "due_at",
  estimate: "estimate_hours",
  blockedReason: "blocked_reason",
};

export const DESCRIPTION_BLOCK = "description";

type TaskRow = Record<string, unknown> & { description: string | null; title: string };

async function load(id: string): Promise<TaskRow | null> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("task")
    .select(`description, ${Object.values(COLUMNS).join(", ")}`)
    .eq("id", id)
    .maybeSingle();
  return (data as TaskRow | null) ?? null;
}

async function update(id: string, patch: Record<string, unknown>): Promise<void> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from("task").update(patch).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("not_found");
}

export const taskContentAdapter: ObjectContentAdapter = {
  restorableProperties: Object.keys(COLUMNS),

  async read(object: ObjectRef) {
    const row = await load(object.id);
    if (!row) return null;
    const properties: PropertySnapshot = {};
    for (const [key, column] of Object.entries(COLUMNS)) properties[key] = row[column] ?? null;
    const content: ContentSnapshot = {
      version: 1,
      blocks: [{ id: DESCRIPTION_BLOCK, type: "paragraph", text: row.description ?? "" }],
    };
    return { content, properties };
  },

  async title(object: ObjectRef) {
    return (await load(object.id))?.title ?? null;
  },

  async writeContent(object: ObjectRef, content: ContentSnapshot) {
    const text = content.blocks.map((block) => block.text).join("\n\n");
    await update(object.id, { description: text.length > 0 ? text : null });
  },

  async writeProperties(object: ObjectRef, properties: PropertySnapshot) {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      const column = COLUMNS[key];
      if (column) patch[column] = value;
    }
    if (Object.keys(patch).length > 0) await update(object.id, patch);
  },
};
