"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  contentToPlainText,
  normalizeContent,
  type EditorBlock,
  type EditorContent,
} from "@/features/editor/adapter/content";

/**
 * Synced blocks (U5b): a group of blocks kept once in `synced_block` and shown
 * on several pages. Everything runs as the signed-in person, so RLS decides:
 * a synced block is read as its source document is, and written only by
 * someone who can edit that source. A reader who cannot see it gets no
 * content back, only whether they have asked for access.
 */

export type SyncedAccessState = "none" | "requested" | "declined";

export interface SyncedBlockView {
  id: string;
  content: EditorContent;
  canEdit: boolean;
  pageCount: number;
  requests: { requesterId: string; name: string }[];
}

const idSchema = z.string().uuid();
const sourceSchema = z.object({
  sourceObjectId: idSchema,
  sourceObjectType: z.enum(["page", "task", "meeting"]),
  sourceBlockId: z.string().trim().min(1).max(100),
  content: z.unknown(),
});
const updateSchema = z.object({ id: idSchema, content: z.unknown() });
const decideSchema = z.object({ id: idSchema, requesterId: idSchema, grant: z.boolean() });

/** Stays well under the table's 1 MB limit and a server action's request cap. */
const MAX_CONTENT_CHARS = 900_000;

async function ready() {
  if (!(await isEnabled("wos_editor"))) return null;
  const session = await requireSession();
  return { session, supabase: await createSupabaseServerClient() };
}

/** No synced block inside a synced block: copies would show each other forever. */
function withoutSyncedBlocks(blocks: EditorBlock[]): EditorBlock[] {
  return blocks
    .filter((block) => block.type !== "syncedBlock")
    .map((block) => (block.children ? { ...block, children: withoutSyncedBlocks(block.children) } : block));
}

/** Valid, flat-of-synced-blocks content within the size limit, or null. */
function cleanContent(value: unknown): EditorContent | null {
  const normalized = normalizeContent(value);
  const content = { ...normalized, blocks: withoutSyncedBlocks(normalized.blocks) };
  return JSON.stringify(content).length > MAX_CONTENT_CHARS ? null : content;
}

/** Makes a synced block from blocks selected on a page (or an empty one); returns its id. */
export async function createSyncedBlock(input: unknown): Promise<{ ok: true; id: string } | { ok: false }> {
  const context = await ready();
  if (!context) return { ok: false };
  if (await enforceRateLimit("editor:save", context.session.userId)) return { ok: false };
  const parsed = sourceSchema.safeParse(input);
  const content = parsed.success ? cleanContent(parsed.data.content) : null;
  if (!parsed.success || !content) return { ok: false };
  const { data, error } = await context.supabase
    .from("synced_block")
    .insert({
      organization_id: context.session.organizationId,
      source_object_id: parsed.data.sourceObjectId,
      source_object_type: parsed.data.sourceObjectType,
      source_block_id: parsed.data.sourceBlockId,
      content,
      content_text: contentToPlainText(content).slice(0, 500000),
      created_by: context.session.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false };
  return { ok: true, id: data.id as string };
}

/** Saves the source's edit; every copy shows it the next time it loads. */
export async function updateSyncedBlock(input: unknown): Promise<{ ok: boolean }> {
  const context = await ready();
  if (!context) return { ok: false };
  if (await enforceRateLimit("editor:save", context.session.userId)) return { ok: false };
  const parsed = updateSchema.safeParse(input);
  const content = parsed.success ? cleanContent(parsed.data.content) : null;
  if (!parsed.success || !content) return { ok: false };
  const { data, error } = await context.supabase
    .from("synced_block")
    .update({ content, content_text: contentToPlainText(content).slice(0, 500000) })
    .eq("id", parsed.data.id)
    .select("id");
  return { ok: !error && (data ?? []).length === 1 };
}

/**
 * The block as this reader may see it; when RLS returns nothing, only
 * whether they have already asked for access (never the content).
 */
export async function loadSyncedBlock(
  idInput: unknown,
): Promise<{ ok: true; block: SyncedBlockView } | { ok: false; access: SyncedAccessState } | null> {
  const context = await ready();
  const id = idSchema.safeParse(idInput);
  if (!context || !id.success) return null;
  const { supabase, session } = context;
  const { data: row } = await supabase.from("synced_block").select("id, content").eq("id", id.data).maybeSingle();
  if (!row) {
    const { data: request } = await supabase
      .from("synced_block_access_request")
      .select("status")
      .eq("synced_block_id", id.data)
      .eq("requester_id", session.userId)
      .maybeSingle();
    const status = request?.status as string | undefined;
    // A granted request that still reads nothing (the person left the
    // organization, say) is no access.
    return { ok: false, access: status === "requested" || status === "declined" ? status : "none" };
  }

  const [canEdit, usage] = await Promise.all([
    supabase.rpc("can_edit_synced_block", { p_synced_block: id.data }),
    // Pages showing it, as far as this reader can see them (block rows follow
    // their document's read rule).
    supabase.from("block").select("object_id").eq("type", "syncedBlock").eq("props->>syncedBlockId", id.data).limit(1000),
  ]);
  const editable = !canEdit.error && canEdit.data === true;
  let requests: SyncedBlockView["requests"] = [];
  if (editable) {
    const { data } = await supabase
      .from("synced_block_access_request")
      .select("requester_id, requester:user_profile!synced_block_access_request_requester_id_fkey(full_name)")
      .eq("synced_block_id", id.data)
      .eq("status", "requested")
      .order("created_at")
      .limit(50);
    requests = (data ?? []).map((request) => ({
      requesterId: request.requester_id as string,
      name: ((request.requester as unknown as { full_name: string | null } | null)?.full_name ?? "").trim() || "—",
    }));
  }
  return {
    ok: true,
    block: {
      id: row.id as string,
      content: normalizeContent(row.content),
      canEdit: editable,
      pageCount: new Set((usage.data ?? []).map((block) => block.object_id as string)).size,
      requests,
    },
  };
}

/** Synced blocks this reader can see, newest first, for showing one on another page. */
export async function listSyncedBlocks(
  queryInput: unknown,
): Promise<{ id: string; preview: string; sourceTitle: string }[]> {
  const context = await ready();
  const query = z.string().trim().max(100).safeParse(queryInput ?? "");
  if (!context || !query.success) return [];
  let request = context.supabase
    .from("synced_block")
    .select("id, content_text, source_object_id, source_object_type")
    .order("updated_at", { ascending: false })
    .limit(8);
  if (query.data) request = request.ilike("content_text", `%${query.data.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { data } = await request;
  const rows = (data ?? []).map((row) => ({
    id: row.id as string,
    sourceId: row.source_object_id as string,
    sourceType: row.source_object_type as string,
    text: (row.content_text as string | null) ?? "",
  }));
  const pageIds = [...new Set(rows.filter((row) => row.sourceType === "page").map((row) => row.sourceId))];
  const { data: pages } = pageIds.length
    ? await context.supabase.from("page").select("id, title").in("id", pageIds)
    : { data: [] as { id: string; title: string }[] };
  const titles = new Map((pages ?? []).map((page) => [page.id as string, (page.title as string) || "—"]));
  return rows.map((row) => ({
    id: row.id,
    preview: (row.text.split("\n").find((line) => line.trim()) ?? "").slice(0, 120),
    sourceTitle: titles.get(row.sourceId) ?? "—",
  }));
}

/** Asks to read a synced block whose source this person cannot open. */
export async function requestSyncedAccess(idInput: unknown): Promise<{ ok: boolean; access?: SyncedAccessState }> {
  const context = await ready();
  const id = idSchema.safeParse(idInput);
  if (!context || !id.success) return { ok: false };
  if (await enforceRateLimit("editor:save", context.session.userId)) return { ok: false };
  const { error } = await context.supabase.from("synced_block_access_request").insert({
    synced_block_id: id.data,
    requester_id: context.session.userId,
    organization_id: context.session.organizationId,
  });
  if (!error) return { ok: true, access: "requested" };
  if (error.code === "23505") {
    // Asked before: report where that request stands.
    const { data } = await context.supabase
      .from("synced_block_access_request")
      .select("status")
      .eq("synced_block_id", id.data)
      .eq("requester_id", context.session.userId)
      .maybeSingle();
    return { ok: true, access: data?.status === "declined" ? "declined" : "requested" };
  }
  return { ok: false };
}

/** Grants or declines a request; RLS lets only someone who can edit the source. */
export async function decideSyncedAccess(input: unknown): Promise<{ ok: boolean }> {
  const context = await ready();
  const parsed = decideSchema.safeParse(input);
  if (!context || !parsed.success) return { ok: false };
  if (await enforceRateLimit("editor:save", context.session.userId)) return { ok: false };
  const { data, error } = await context.supabase
    .from("synced_block_access_request")
    .update({ status: parsed.data.grant ? "granted" : "declined" })
    .eq("synced_block_id", parsed.data.id)
    .eq("requester_id", parsed.data.requesterId)
    .eq("status", "requested")
    .select("id");
  return { ok: !error && (data ?? []).length === 1 };
}
