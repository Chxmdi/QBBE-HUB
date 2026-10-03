"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createLensRunQuery } from "@/lib/query/contract-adapter";
import { loadCatalog } from "@/lib/query/run";
import { bulkUpdateTasks, createTask, updateTaskStatus } from "@/features/tasks/services/task.commands";
import { parseStoredSpec, toQueryBlockRow, type QueryBlockRow } from "@/features/editor/semantic/queries";
import { contentToPlainText, normalizeContent, type EditorBlock } from "@/features/editor/adapter/content";
import { createPage } from "@/features/pages/services/page.commands";
import { isCalendarDate } from "@/lib/schema";

/**
 * Data for semantic blocks (M5). Every read runs as the signed-in person, so
 * a block pointing at something they cannot see shows as unavailable rather
 * than leaking its title. Task changes go through the tasks feature's own
 * actions, with its checks, history and notifications.
 */

export type SemanticKind = "task" | "decision" | "person" | "document" | "page";

export interface ObjectSummary {
  id: string;
  kind: SemanticKind;
  title: string;
  /** Task status, decision date, or a document's scan status. */
  detail: string | null;
  done?: boolean;
  archived?: boolean;
  /** A task's due day and assignee, read live so an edit elsewhere shows here. */
  dueAt?: string | null;
  assigneeName?: string | null;
  href: string | null;
}

const idSchema = z.string().uuid();
const kindSchema = z.enum(["task", "decision", "person", "document", "page"]);
const summariesSchema = z.array(z.object({ kind: kindSchema, id: idSchema })).max(100);

async function ready() {
  if (!(await isEnabled("wos_editor"))) return null;
  const session = await requireSession();
  return { session, supabase: await createSupabaseServerClient() };
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function read(supabase: Client, kind: SemanticKind, ids: string[]): Promise<ObjectSummary[]> {
  if (ids.length === 0) return [];
  if (kind === "task") {
    const { data } = await supabase
      .from("task")
      .select("id, title, status, due_at, archived_at, assignee:assignee_id(full_name)")
      .in("id", ids);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      kind,
      title: row.title as string,
      detail: row.status as string,
      done: row.status === "completed",
      archived: row.archived_at !== null,
      dueAt: (row.due_at as string | null) ?? null,
      assigneeName: (row.assignee as unknown as { full_name: string | null } | null)?.full_name ?? null,
      href: `/my-work?task=${row.id}`,
    }));
  }
  if (kind === "decision") {
    const { data } = await supabase.from("decision").select("id, title, decided_at, project_id").in("id", ids);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      kind,
      title: row.title as string,
      detail: (row.decided_at as string | null) ?? null,
      href: row.project_id ? `/projects/${row.project_id}?tab=decisions` : null,
    }));
  }
  if (kind === "person") {
    const { data } = await supabase.from("user_profile").select("id, full_name").in("id", ids);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      kind,
      title: (row.full_name as string) || "—",
      detail: null,
      href: `/people/${row.id}`,
    }));
  }
  if (kind === "page") {
    const { data } = await supabase.from("page").select("id, title, icon, deleted_at").in("id", ids);
    return (data ?? [])
      .filter((row) => !row.deleted_at)
      .map((row) => ({
        id: row.id as string,
        kind,
        title: (row.title as string) || "—",
        detail: (row.icon as string | null) ?? null,
        href: `/pages/${row.id}`,
      }));
  }
  const { data } = await supabase.from("document").select("id, title, scan_status, kind").in("id", ids);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind,
    title: row.title as string,
    detail: row.kind === "link" ? "clean" : (row.scan_status as string),
    // The library has no page per file; the block opens it through a signed link.
    href: null,
  }));
}

/** Summaries for the objects on screen; ones the reader cannot see are simply absent. */
export async function summarizeObjects(input: unknown): Promise<ObjectSummary[]> {
  const context = await ready();
  const parsed = summariesSchema.safeParse(input);
  if (!context || !parsed.success) return [];
  const byKind = new Map<SemanticKind, string[]>();
  for (const ref of parsed.data) byKind.set(ref.kind, [...(byKind.get(ref.kind) ?? []), ref.id]);
  const groups = await Promise.all([...byKind].map(([kind, ids]) => read(context.supabase, kind, [...new Set(ids)])));
  return groups.flat();
}

/** Up to eight objects of one kind matching the words typed, for the block's picker. */
export async function searchObjects(kindInput: unknown, queryInput: unknown): Promise<ObjectSummary[]> {
  const context = await ready();
  const kind = kindSchema.safeParse(kindInput);
  const query = z.string().trim().max(100).safeParse(queryInput);
  if (!context || !kind.success || !query.success) return [];
  const { supabase, session } = context;
  const pattern = `%${query.data.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  if (kind.data === "person") {
    const { data } = await supabase
      .from("organization_membership")
      .select("user_id, user_profile!inner(full_name)")
      .eq("organization_id", session.organizationId)
      .eq("status", "active")
      .ilike("user_profile.full_name", pattern)
      .limit(8);
    return read(supabase, "person", (data ?? []).map((row) => row.user_id as string));
  }
  const table = { task: "task", decision: "decision", document: "document", page: "page" }[kind.data];
  let request = supabase.from(table).select("id").ilike("title", pattern).limit(8);
  if (kind.data === "task" || kind.data === "document") request = request.is("archived_at", null);
  if (kind.data === "page") request = request.is("deleted_at", null);
  const { data } = await request;
  return read(supabase, kind.data, (data ?? []).map((row) => row.id as string));
}

/**
 * Projects a new task can go in. Tasks outside a project are for admins only
 * (app.can_create_scoped_task), so the task block asks for one; the database
 * still decides whether this person may add tasks to the chosen project.
 */
export async function listTaskProjects(): Promise<{ id: string; name: string }[]> {
  const context = await ready();
  if (!context) return [];
  const { data } = await context.supabase
    .from("project")
    .select("id, name")
    .is("archived_at", null)
    .order("name")
    .limit(200);
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
}

/** Creates a task from a task block and returns it; the block then is that task. */
const taskExtrasSchema = z
  .object({
    assigneeId: idSchema.optional(),
    dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate).optional(),
  })
  .default({});

/** The page or meeting the block sits in (M7b); `manual` when there is none. */
const taskSourceSchema = z.object({ type: z.enum(["page", "meeting"]), id: idSchema }).optional();

export async function createTaskFromBlock(
  titleInput: unknown,
  projectInput?: unknown,
  extrasInput?: unknown,
  sourceInput?: unknown,
): Promise<{ ok: true; task: ObjectSummary } | { ok: false; error?: string }> {
  const context = await ready();
  const title = z.string().trim().min(1).max(300).safeParse(titleInput);
  const projectId = idSchema.optional().safeParse(projectInput ?? undefined);
  const extras = taskExtrasSchema.safeParse(extrasInput ?? undefined);
  const source = taskSourceSchema.safeParse(sourceInput ?? undefined);
  if (!context || !title.success || !projectId.success || !extras.success || !source.success) return { ok: false };
  // The shared action checks the caller can see the page or meeting named.
  const result = await createTask({
    title: title.data,
    ...(projectId.data ? { projectId: projectId.data } : {}),
    ...(extras.data.assigneeId ? { assigneeId: extras.data.assigneeId } : {}),
    ...(extras.data.dueAt ? { dueAt: extras.data.dueAt } : {}),
    source: source.data ?? { type: "manual", id: null },
  });
  if (!result.ok || !result.id) return { ok: false, error: result.error };
  if (source.data?.type === "meeting") {
    // A task written in the notes is one of the meeting's actions, as a task
    // approved in the review is: the classic meeting page lists it and the
    // database keeps its due date and owner in step with the task
    // (20261107030100). Editing the notes already needs meeting management,
    // which is the rule for this row too; the task stands on its own if the
    // link is refused, with the meeting still recorded as its source.
    await context.supabase.from("meeting_action").insert({
      meeting_id: source.data.id,
      task_id: result.id,
      title: title.data,
      owner_id: extras.data.assigneeId ?? null,
      due_at: extras.data.dueAt ?? null,
    });
  }
  const [task] = await read(context.supabase, "task", [result.id]);
  return task ? { ok: true, task } : { ok: false };
}

/** Ticks a task block: completed, or back to not started. */
export async function setTaskDone(taskIdInput: unknown, done: boolean): Promise<{ ok: boolean; error?: string }> {
  const context = await ready();
  const taskId = idSchema.safeParse(taskIdInput);
  if (!context || !taskId.success) return { ok: false };
  const result = await updateTaskStatus(taskId.data, done ? "completed" : "not_started");
  return { ok: result.ok, error: result.error };
}

/** Archives the task whose block was deleted, when the person says so. */
export async function archiveTaskFromBlock(taskIdInput: unknown): Promise<{ ok: boolean; error?: string }> {
  const context = await ready();
  const taskId = idSchema.safeParse(taskIdInput);
  if (!context || !taskId.success) return { ok: false };
  const result = await bulkUpdateTasks({ taskIds: [taskId.data], action: "archive" });
  return { ok: result.ok, error: result.error };
}

/**
 * Runs a query block's stored spec as the viewer through the lens query
 * engine: the catalog says which types and properties exist, the database
 * applies row-level security. A spec the engine refuses, or a failure running
 * it, both read as "could not be loaded" in the block.
 */
export async function runQueryBlock(specInput: unknown): Promise<{ ok: true; rows: QueryBlockRow[] } | { ok: false }> {
  const context = await ready();
  const spec = parseStoredSpec(specInput);
  if (!context || !spec) return { ok: false };
  try {
    const [catalog, locale] = await Promise.all([loadCatalog(context.supabase), getLocale()]);
    const run = createLensRunQuery(context.supabase, catalog, { timeZone: context.session.timeZone });
    const result = await run(spec);
    return { ok: true, rows: result.rows.map((row) => toQueryBlockRow(row, catalog, locale)) };
  } catch {
    return { ok: false };
  }
}

/** Active members, for the "Make a task" suggestion's person matching (M6). */
export async function listPeople(): Promise<{ id: string; name: string }[]> {
  const context = await ready();
  if (!context) return [];
  const { data } = await context.supabase
    .from("organization_membership")
    .select("user_id, user_profile!inner(full_name)")
    .eq("organization_id", context.session.organizationId)
    .eq("status", "active")
    .limit(1000);
  return (data ?? [])
    .map((row) => ({
      id: row.user_id as string,
      name: ((row.user_profile as unknown as { full_name: string | null } | null)?.full_name ?? "").trim(),
    }))
    .filter((person) => person.name.length > 1);
}

const turnIntoPageSchema = z.object({
  parentPageId: idSchema,
  title: z.string().trim().max(500),
  content: z.unknown(),
});

/**
 * "Turn into page" (M6): a new page inside the current one, holding a copy
 * of the selected blocks. The original blocks stay where they were; the
 * editor adds a link block to the new page beside them.
 */
export async function turnIntoPage(input: unknown): Promise<{ ok: true; page: ObjectSummary } | { ok: false; error?: string }> {
  const context = await ready();
  const parsed = turnIntoPageSchema.safeParse(input);
  if (!context || !parsed.success || !(await isEnabled("wos_pages"))) return { ok: false };
  const created = await createPage({ parentPageId: parsed.data.parentPageId, title: parsed.data.title });
  if (!created.ok || !created.id) return { ok: false, error: created.error };
  const content = normalizeContent({ blocks: stripIds(normalizeContent(parsed.data.content).blocks) });
  const { error } = await context.supabase.from("editor_document").insert({
    object_id: created.id,
    object_type: "page",
    organization_id: context.session.organizationId,
    content,
    content_text: contentToPlainText(content).slice(0, 500000),
    created_by: context.session.userId,
  });
  if (error) return { ok: false };
  const [page] = await read(context.supabase, "page", [created.id]);
  return page ? { ok: true, page } : { ok: false };
}

/** Copied blocks get new ids in their new document. */
function stripIds(blocks: EditorBlock[]): EditorBlock[] {
  return blocks.map(({ id: _id, children, ...rest }) => {
    void _id;
    return { ...rest, ...(children ? { children: stripIds(children) } : {}) };
  });
}
