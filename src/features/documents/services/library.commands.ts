"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { FOLDER_CATEGORIES, tagsSchemaFor } from "@/features/documents/services/library";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

// Library actions (#147). Row-level security and the triggers in migration
// 20260927600000 are the authorization and the version bookkeeping; these
// actions validate input so a refusal can be explained, and revalidate pages.
// Audit events for versions, filing, required reading, confirmations and
// folders are written by the database, so they cannot be skipped.

const httpsUrl = (t: TranslateFn) =>
  z
    .string()
    .trim()
    .url(t("documents.errors.invalidUrl"))
    .refine((value) => /^https:\/\//i.test(value), t("documents.errors.httpsOnly"));

const versionSchema = (t: TranslateFn) => z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    supersedesId: z.string().uuid(),
    storagePath: requiredText(t("documents.errors.fileMissing"), 500),
    mimeType: z.string().trim().max(200).optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal("link"),
    supersedesId: z.string().uuid(),
    url: httpsUrl(t),
  }),
]);

/**
 * Adds a new version of a document. The new row inherits the previous
 * version's title, folder, audience, tags and required-reading flag; the
 * previous version is kept and marked superseded by the database.
 */
export async function addDocumentVersion(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;

  const parsed = versionSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("documents.errors.invalidInput") };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: previous } = await supabase
    .from("document")
    .select("id, title, description, superseded_at, archived_at")
    .eq("id", data.supersedesId)
    .maybeSingle();
  if (!previous) return { ok: false, error: t("documents.errors.notAccessible") };
  if (previous.superseded_at || previous.archived_at) {
    return {
      ok: false,
      error: t("documents.errors.newerVersion"),
    };
  }

  const { data: doc, error } = await supabase
    .from("document")
    .insert({
      organization_id: session.organizationId,
      title: previous.title,
      description: previous.description,
      kind: data.kind,
      url: data.kind === "link" ? data.url : null,
      storage_path: data.kind === "file" ? data.storagePath : null,
      mime_type: data.kind === "file" ? data.mimeType || null : null,
      size_bytes: data.kind === "file" ? (data.sizeBytes ?? null) : null,
      supersedes_id: previous.id,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !doc) {
    if (error?.code === "42501") {
      return { ok: false, error: t("documents.errors.cannotAddVersion") };
    }
    if (error?.code === "23514" && data.kind === "link") {
      return { ok: false, error: t("documents.errors.linkNotApproved") };
    }
    if (error?.code === "23514" || error?.code === "23505") {
      return {
        ok: false,
        error: t("documents.errors.newerVersion"),
      };
    }
    return { ok: false, error: t("documents.errors.saveVersion") };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${previous.id}`);
  return { ok: true, id: doc.id as string };
}

const detailsSchema = (t: TranslateFn) => z.object({
  documentId: z.string().uuid(),
  folderId: z
    .string()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(z.string().uuid().nullable()),
  tags: tagsSchemaFor(t),
  requiresAcknowledgement: z.boolean().default(false),
});

/** Files a document in a folder, sets its tags and its required-reading flag. */
export async function updateDocumentDetails(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = detailsSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("documents.errors.invalidInput") };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: updated, error } = await supabase
    .from("document")
    .update({
      folder_id: data.folderId,
      tags: data.tags,
      requires_acknowledgement: data.requiresAcknowledgement,
    })
    .eq("id", data.documentId)
    .is("superseded_at", null)
    .select("id");

  if (error) {
    if (error.code === "42501") {
      return {
        ok: false,
        error: data.requiresAcknowledgement
          ? t("documents.errors.staffFolderOrReading")
          : t("documents.errors.staffFolder"),
      };
    }
    if (error.code === "23514") {
      return {
        ok: false,
        error: data.requiresAcknowledgement
          ? t("documents.errors.requiredReadingRules")
          : t("documents.errors.folderUnavailable"),
      };
    }
    return { ok: false, error: t("documents.errors.saveDetails") };
  }
  if (!updated?.length) {
    return { ok: false, error: t("documents.errors.cannotChange") };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${data.documentId}`);
  return { ok: true, id: data.documentId };
}

/** Records that the signed-in member has read a required document. */
export async function acknowledgeDocument(documentId: string): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const id = z.string().uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: t("documents.errors.documentNotFound") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("document_acknowledgement").insert({
    document_id: id.data,
    user_id: session.userId,
    organization_id: session.organizationId,
  });

  // Confirming twice is not an error: the first confirmation stands.
  if (error && error.code !== "23505") {
    return {
      ok: false,
      error: t("documents.errors.confirmation"),
    };
  }

  revalidatePath(`/documents/${id.data}`);
  revalidatePath("/documents");
  return { ok: true, id: id.data };
}

const folderSchema = (t: TranslateFn) => z.object({
  category: z.enum(FOLDER_CATEGORIES.map((c) => c.id) as [string, ...string[]], {
    errorMap: () => ({ message: t("documents.errors.chooseCategory") }),
  }),
  name: requiredText(t("documents.errors.folderName"), 80),
  visibility: z.enum(["organization", "staff"]).default("organization"),
});

/** Creates a library folder. Administrators only, with MFA. */
export async function createDocumentFolder(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;
  const t = await getT();

  const parsed = folderSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("documents.errors.invalidInput") };
  }
  const supabase = await createSupabaseServerClient();
  const { data: folder, error } = await supabase
    .from("document_folder")
    .insert({
      organization_id: session.organizationId,
      category: parsed.data.category,
      name: parsed.data.name,
      visibility: parsed.data.visibility,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !folder) {
    if (error?.code === "23505") {
      return { ok: false, error: t("documents.errors.folderExists") };
    }
    return { ok: false, error: t("documents.errors.createFolder") };
  }
  revalidatePath("/documents");
  return { ok: true, id: folder.id as string };
}
