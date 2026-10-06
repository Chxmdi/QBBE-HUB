"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";
import { tagsSchemaFor } from "@/features/documents/services/library";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

const linkSchema = (t: TranslateFn) => z.object({
  title: requiredText(t("documents.errors.linkTitle"), 200),
  // https only, and not merely "a valid URL". `new URL()` — which is what Zod's
  // `.url()` defers to — parses `javascript:alert(1)` and
  // `data:text/html,<script>…</script>` without complaint, and a link document's
  // stored URL is handed straight to `window.open` when somebody opens it.
  url: z
    .string()
    .trim()
    .url(t("documents.errors.invalidUrl"))
    .refine(
      (value) => /^https:\/\//i.test(value),
      t("documents.errors.httpsOnly"),
    ),
  description: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  visibility: z.enum(["organization", "staff"]).default("organization"),
  folderId: z.string().uuid().optional(),
  tags: tagsSchemaFor(t),
});

/** Registers an external resource link (QBBE-controlled Drive, etc.). */
export async function createDocumentLink(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();

  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = linkSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("documents.errors.invalidInput") };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();

  // The approved-source check the PRD row asks for (P0-FIL-01). The database
  // enforces this too, in `app.reject_unapproved_document_link`, because a form
  // is not a control — PostgREST is reachable without one. This is here so the
  // refusal can name the sources that would work, which a trigger's error
  // cannot do well.
  let host: string;
  try {
    host = new URL(data.url).hostname.toLowerCase();
  } catch {
    return { ok: false, error: t("documents.errors.invalidUrl") };
  }

  const { data: approved, error: approvedError } = await supabase
    .from("approved_document_host")
    .select("host, label")
    .eq("organization_id", session.organizationId)
    .order("host");

  // A failed read is not an empty allowlist. Treating it as one would refuse
  // every link and blame the person's URL for it.
  if (approvedError) {
    return { ok: false, error: t("documents.errors.hostsUnavailable") };
  }

  if (!approved?.some((row) => row.host === host)) {
    const names = (approved ?? []).map((row) => row.label || row.host);
    return {
      ok: false,
      error: names.length
        ? t("documents.errors.hostNotApproved", { host, hosts: names.join(", ") })
        : t("documents.errors.hostNotApprovedNone", { host }),
    };
  }

  const { data: doc, error } = await supabase
    .from("document")
    .insert({
      organization_id: session.organizationId,
      title: data.title,
      description: data.description || null,
      kind: "link",
      url: data.url,
      project_id: data.projectId ?? null,
      program_id: data.programId ?? null,
      visibility: data.visibility,
      folder_id: data.folderId ?? null,
      tags: data.tags,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !doc) return { ok: false, error: t("documents.errors.saveResource") };

  revalidatePath("/documents");
  return { ok: true, id: doc.id as string };
}

const fileSchema = (t: TranslateFn) => z.object({
  title: z.string().trim().min(1).max(200),
  storagePath: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.coerce.number().int().min(0).optional(),
  description: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  visibility: z.enum(["organization", "staff"]).default("organization"),
  folderId: z.string().uuid().optional(),
  tags: tagsSchemaFor(t),
  /** The page, task or meeting whose editor the file was added in: its readers read the file. */
  editorObject: z.object({ type: z.enum(["page", "task", "meeting"]), id: z.string().uuid() }).optional(),
});

/** Records an uploaded file after the client streams it into Storage. */
export async function registerUploadedDocument(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = fileSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("documents.errors.invalidInput") };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: doc, error } = await supabase
    .from("document")
    .insert({
      organization_id: session.organizationId,
      title: data.title,
      description: data.description || null,
      kind: "file",
      storage_path: data.storagePath,
      mime_type: data.mimeType || null,
      size_bytes: data.sizeBytes ?? null,
      project_id: data.projectId ?? null,
      program_id: data.programId ?? null,
      visibility: data.visibility,
      folder_id: data.folderId ?? null,
      editor_object_type: data.editorObject?.type ?? null,
      editor_object_id: data.editorObject?.id ?? null,
      tags: data.tags,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !doc) return { ok: false, error: t("documents.errors.recordUpload") };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "documents",
    action: "document_uploaded",
    object_type: "document",
    object_id: doc.id,
  });

  revalidatePath("/documents");
  return { ok: true, id: doc.id as string };
}

/**
 * Issues a short-lived signed URL for a private file (SEC-007). RLS on
 * `document` gates the lookup, so a user who cannot see the record cannot
 * obtain a URL for it.
 */
export async function getDocumentDownloadUrl(
  documentId: string,
): Promise<ActionResult & { url?: string }> {
  const session = await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();

  const { data: doc } = await supabase
    .from("document")
    .select("kind, url, storage_path, title, scan_status")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return { ok: false, error: t("documents.errors.notAccessible") };
  if (doc.kind === "link") return { ok: true, url: doc.url as string };
  if (doc.scan_status !== "clean") {
    return { ok: false, error: t("documents.errors.stillChecking") };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path as string, 60);

  if (error || !signed) {
    return { ok: false, error: t("documents.errors.downloadLink") };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "documents",
    action: "document_downloaded",
    object_type: "document",
    object_id: documentId,
  });

  return { ok: true, url: signed.signedUrl };
}

export async function archiveDocument(documentId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: changed, error } = await supabase
    .from("document")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", documentId)
    .select("id");
  // A refused archive matches no row; say so rather than report success.
  if (error || !changed || changed.length === 0) {
    return { ok: false, error: (await getT())("documents.errors.archive") };
  }

  revalidatePath("/documents");
  return { ok: true };
}

export async function restoreDocument(documentId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: changed, error } = await supabase
    .from("document")
    .update({ archived_at: null })
    .eq("id", documentId)
    .not("archived_at", "is", null)
    .select("id");
  // No row: refused, or not archived to begin with. Either way nothing was restored.
  if (error || !changed || changed.length === 0) {
    return { ok: false, error: (await getT())("documents.errors.restore") };
  }
  revalidatePath("/documents");
  return { ok: true };
}

const textSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(400_000),
  source: z.enum(["pdf_text", "ocr"]),
});

/**
 * Stores the words the browser read out of an uploaded file, for search
 * (#147). The database decides who may (whoever added or manages the
 * document), cleans the text, and never uses it for anything but search.
 * A failure here is not the upload's failure: the file is saved either way.
 */
export async function saveDocumentText(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = textSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getT())("documents.errors.storeText") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_document_text", {
    p_document: parsed.data.id,
    p_text: parsed.data.text,
    p_source: parsed.data.source,
  });
  if (error) return { ok: false, error: (await getT())("documents.errors.storeText") };
  return { ok: true, id: parsed.data.id };
}
