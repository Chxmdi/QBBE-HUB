import { createSupabaseServerClient } from "@/lib/supabase/server";
import { taskSystemProperties } from "@/lib/objects/stubs";
import { readLayout, type LayoutCatalog, type ObjectLayout } from "../layout";

export interface ObjectTypeSummary {
  id: string;
  key: string;
  name: { en: string; fr: string };
  kind: "native" | "custom";
}

/** The organization's object types, as the reader sees them. */
export async function listObjectTypes(): Promise<ObjectTypeSummary[]> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_type")
    .select("id, key, name_en, name_fr, kind")
    .is("archived_at", null)
    .order("key");
  return ((data ?? []) as { id: string; key: string; name_en: string; name_fr: string; kind: "native" | "custom" }[]).map(
    (row) => ({ id: row.id, key: row.key, name: { en: row.name_en, fr: row.name_fr }, kind: row.kind }),
  );
}

/** The stored layout for a type, or the default when there is none. */
export async function loadLayout(typeId: string, catalog: LayoutCatalog): Promise<{ layout: ObjectLayout; saved: boolean }> {
  const db = await createSupabaseServerClient();
  const { data } = await db.from("object_layout").select("layout").eq("type_id", typeId).maybeSingle();
  return { layout: readLayout(data?.layout ?? null, catalog), saved: Boolean(data) };
}

export type DisplayValue =
  | { kind: "text"; text: string }
  | { kind: "date"; iso: string; time: boolean }
  | { kind: "link"; text: string; href: string }
  | { kind: "empty" };

export interface RelatedItem {
  id: string;
  title: string;
  href: string;
}

export interface ObjectPageData {
  title: string;
  values: Record<string, DisplayValue>;
  related: Record<string, RelatedItem[]>;
  content: string | null;
}

const PERSON_COLUMNS = new Set(["assignee_id", "requester_id", "reviewer_id", "created_by"]);

/**
 * A task's values and related lists, read as the viewer (RLS decides). Null
 * when the viewer cannot see the task.
 */
export async function loadTaskPage(taskId: string): Promise<ObjectPageData | null> {
  const db = await createSupabaseServerClient();
  const columns = [...new Set(Object.values(taskSystemProperties).map((p) => p.column)), "description"];
  const { data } = await db.from("task").select(columns.join(", ")).eq("id", taskId).maybeSingle();
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;

  const personIds = [...PERSON_COLUMNS].map((column) => row[column]).filter((v): v is string => typeof v === "string");
  const [people, project, program, blocking, blockedBy] = await Promise.all([
    personIds.length
      ? db.from("user_profile").select("id, full_name").in("id", personIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    row.project_id ? db.from("project").select("id, name").eq("id", row.project_id as string).maybeSingle() : Promise.resolve({ data: null }),
    row.program_id ? db.from("program").select("id, name").eq("id", row.program_id as string).maybeSingle() : Promise.resolve({ data: null }),
    db.from("task_dependency").select("blocked_task_id, task:blocked_task_id(id, title)").eq("blocking_task_id", taskId).limit(50),
    db.from("task_dependency").select("blocking_task_id, task:blocking_task_id(id, title)").eq("blocked_task_id", taskId).limit(50),
  ]);
  const names = new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  const projectRow = project.data as { id: string; name: string } | null;
  const programRow = program.data as { id: string; name: string } | null;

  const values: Record<string, DisplayValue> = {};
  for (const [key, property] of Object.entries(taskSystemProperties)) {
    const raw = row[property.column];
    if (raw === null || raw === undefined || raw === "") values[key] = { kind: "empty" };
    else if (PERSON_COLUMNS.has(property.column)) values[key] = { kind: "text", text: names.get(raw as string) ?? "—" };
    else if (key === "project") values[key] = projectRow ? { kind: "link", text: projectRow.name, href: `/projects/${projectRow.id}` } : { kind: "empty" };
    else if (key === "program") values[key] = programRow ? { kind: "text", text: programRow.name } : { kind: "empty" };
    else if (property.time) values[key] = { kind: "date", iso: String(raw), time: property.time === "instant" };
    else values[key] = { kind: "text", text: String(raw) };
  }

  const taskLinks = (rows: unknown[] | null) =>
    ((rows ?? []) as { task: { id: string; title: string } | null }[])
      .filter((r) => r.task)
      .map((r) => ({ id: r.task!.id, title: r.task!.title, href: `/my-work?task=${r.task!.id}` }));

  return {
    title: String(row.title ?? ""),
    values,
    related: {
      project: projectRow ? [{ id: projectRow.id, title: projectRow.name, href: `/projects/${projectRow.id}` }] : [],
      blocking: taskLinks(blocking.data),
      blocked_by: taskLinks(blockedBy.data),
    },
    content: typeof row.description === "string" ? row.description : null,
  };
}
