"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeContent, type EditorContent } from "@/features/editor/adapter/content";
import { byteaHexToBase64, MAX_STATE_BASE64 } from "@/features/editor/adapter/state";

/**
 * Operation-based saves (U3). The browser's save queue appends a batch of
 * operations based on the version it last saw; the database applies them to
 * editor_document in one transaction (public.append_editor_operations), so a
 * stale window gets a conflict instead of overwriting a newer save. Runs as
 * the signed-in person: the function makes editor_document's own access
 * check and nothing here widens it.
 */

export type AppendResult =
  | { ok: true; version: number; seq: number }
  | {
      ok: false;
      reason: "conflict" | "forbidden" | "invalid" | "tooLarge" | "rateLimited" | "failed";
      /** The server's current version, when a conflict reports it. */
      version?: number;
    };

const operationSchema = z.object({
  kind: z.literal("replace"),
  content: z.unknown(),
  /** The editor's Yjs state, base64; null keeps the stored one. */
  state: z.string().max(MAX_STATE_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/).nullable().optional(),
});

const appendSchema = z.object({
  objectId: z.string().uuid(),
  objectType: z.enum(["page", "task"]),
  /** The version the client last saw; null for a first save. */
  baseVersion: z.number().int().positive().nullable(),
  ops: z.array(operationSchema).min(1).max(100),
});

export type EditorOperationInput = z.infer<typeof operationSchema>;

/** editor_document caps content at 5 MB; stay under it with room for the text. */
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

export async function appendEditorOperations(input: unknown): Promise<AppendResult> {
  if (!(await isEnabled("wos_editor"))) return { ok: false, reason: "forbidden" };
  const session = await requireSession();
  const parsed = appendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const limited = await enforceRateLimit("editor:save", session.userId);
  if (limited) return { ok: false, reason: "rateLimited" };

  const ops = parsed.data.ops.map((op) => ({
    kind: "replace" as const,
    content: normalizeContent(op.content),
    state: op.state ?? null,
  }));
  if (ops.some((op) => JSON.stringify(op.content).length > MAX_CONTENT_BYTES)) {
    return { ok: false, reason: "tooLarge" };
  }

  const supabase = await createSupabaseServerClient();
  const { objectId, objectType, baseVersion } = parsed.data;
  const { data, error } = await supabase.rpc("append_editor_operations", {
    p_object: objectId,
    p_type: objectType,
    p_base_version: baseVersion,
    p_ops: ops,
  });
  if (error) {
    if (error.code === "40001") {
      const reported = Number.parseInt(error.details ?? "", 10);
      if (Number.isInteger(reported) && reported > 0) return { ok: false, reason: "conflict", version: reported };
      return currentConflict(supabase, objectId);
    }
    if (error.code === "42501") return { ok: false, reason: "forbidden" };
    if (error.code === "22023" || error.code === "23514" || error.code === "23503") {
      return { ok: false, reason: "invalid" };
    }
    if (error.code === "54000" || error.code === "22021") return { ok: false, reason: "tooLarge" };
    return { ok: false, reason: "failed" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { version?: number; seq?: number | string } | null | undefined;
  if (!row || typeof row.version !== "number") return { ok: false, reason: "failed" };
  return { ok: true, version: row.version, seq: Number(row.seq) };
}

async function currentConflict(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  objectId: string,
): Promise<AppendResult> {
  const { data } = await supabase.from("editor_document").select("version").eq("object_id", objectId).maybeSingle();
  if (!data) return { ok: false, reason: "forbidden" };
  return { ok: false, reason: "conflict", version: data.version as number };
}

export interface ServerEditorDocument {
  content: EditorContent;
  state: string | null;
  version: number;
}

/**
 * The document as the server holds it now: what "Take theirs" loads and what
 * "Review" compares against after a conflict. Null when there is none, or
 * when the reader cannot see it.
 */
export async function loadServerEditorDocument(input: unknown): Promise<ServerEditorDocument | null> {
  if (!(await isEnabled("wos_editor"))) return null;
  await requireSession();
  const parsed = z.string().uuid().safeParse(input);
  if (!parsed.success) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("editor_document")
    .select("content, version, yjs_state")
    .eq("object_id", parsed.data)
    .maybeSingle();
  if (!data) return null;
  return {
    content: normalizeContent(data.content),
    state: byteaHexToBase64(data.yjs_state as string | null),
    version: data.version as number,
  };
}
