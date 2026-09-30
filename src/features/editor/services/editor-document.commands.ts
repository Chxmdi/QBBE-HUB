"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { createEditorT } from "@/features/editor/i18n";
import { contentToPlainText, normalizeContent } from "@/features/editor/adapter/content";
import { documentIdFromRef, documentRef } from "@/features/editor/adapter/files";
import { getDocumentDownloadUrl, registerUploadedDocument } from "@/features/documents/services/document.commands";

/**
 * Saving editor content and the files placed in it (M4b). Runs as the
 * signed-in person: editor_document's RLS follows the page or task, and files
 * are ordinary document-library records, scanned before they can be opened.
 */

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "forbidden" | "invalid" | "failed"; version?: number };

const saveSchema = z.object({
  objectId: z.string().uuid(),
  objectType: z.enum(["page", "task"]),
  /** The version the client last saw; null for a first save. */
  baseVersion: z.number().int().positive().nullable(),
  content: z.unknown(),
});

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

export async function saveEditorDocument(input: unknown): Promise<SaveResult> {
  if (!(await isEnabled("wos_editor"))) return { ok: false, reason: "forbidden" };
  const session = await requireSession();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const content = normalizeContent(parsed.data.content);
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) return { ok: false, reason: "invalid" };
  const text = contentToPlainText(content).slice(0, 500000);
  const supabase = await createSupabaseServerClient();
  const { objectId, objectType, baseVersion } = parsed.data;

  if (baseVersion === null) {
    const { data, error } = await supabase
      .from("editor_document")
      .insert({
        object_id: objectId,
        object_type: objectType,
        organization_id: session.organizationId,
        content,
        content_text: text,
        created_by: session.userId,
      })
      .select("version")
      .single();
    if (data) return { ok: true, version: data.version as number };
    if (error?.code === "23505") return currentConflict(supabase, objectId);
    return { ok: false, reason: error?.code === "42501" ? "forbidden" : "failed" };
  }

  const { data, error } = await supabase
    .from("editor_document")
    .update({ content, content_text: text })
    .eq("object_id", objectId)
    .eq("version", baseVersion)
    .select("version");
  if (error) return { ok: false, reason: error.code === "42501" ? "forbidden" : "failed" };
  if (data && data.length === 1) return { ok: true, version: data[0].version as number };
  return currentConflict(supabase, objectId);
}

async function currentConflict(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  objectId: string,
): Promise<SaveResult> {
  const { data } = await supabase.from("editor_document").select("version").eq("object_id", objectId).maybeSingle();
  // Not visible, or not writable: the update matched nothing for that reason.
  if (!data) return { ok: false, reason: "forbidden" };
  return { ok: false, reason: "conflict", version: data.version as number };
}

const uploadSchema = z.object({
  storagePath: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.number().int().min(0),
});

/**
 * Records a file the browser has put in the `documents` bucket as a library
 * document (staff visibility), which queues its virus scan. Returns the
 * reference the block stores.
 */
export async function registerEditorUpload(input: unknown): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const t = createEditorT(await getLocale());
  if (!(await isEnabled("wos_editor"))) return { ok: false, error: t("files.uploadFailed") };
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("files.uploadFailed") };
  const result = await registerUploadedDocument({
    title: parsed.data.fileName,
    storagePath: parsed.data.storagePath,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    visibility: "staff",
  });
  if (!result.ok || !result.id) return { ok: false, error: result.error ?? t("files.uploadFailed") };
  return { ok: true, ref: documentRef(result.id) };
}

/** A short-lived address for a stored file, or null while its scan is pending or it is not visible. */
export async function resolveEditorFile(ref: string): Promise<string | null> {
  const documentId = documentIdFromRef(ref);
  if (!documentId) return null;
  const result = await getDocumentDownloadUrl(documentId);
  return result.ok && result.url ? result.url : null;
}
