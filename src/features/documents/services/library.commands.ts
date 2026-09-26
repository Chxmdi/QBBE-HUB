"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { FOLDER_CATEGORIES, tagsSchema } from "@/features/documents/services/library";

// Library actions (#147). Row-level security and the triggers in migration
// 20260927600000 are the authorization and the version bookkeeping; these
// actions validate input so a refusal can be explained, and revalidate pages.
// Audit events for versions, filing, required reading, confirmations and
// folders are written by the database, so they cannot be skipped.

const httpsUrl = z
  .string()
  .trim()
  .url("Enter a valid URL.")
  .refine((value) => /^https:\/\//i.test(value), "A resource link must be an https address.");

const versionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    supersedesId: z.string().uuid(),
    storagePath: requiredText("The uploaded file is missing.", 500),
    mimeType: z.string().trim().max(200).optional(),
    sizeBytes: z.coerce.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal("link"),
    supersedesId: z.string().uuid(),
    url: httpsUrl,
  }),
]);

/**
 * Adds a new version of a document. The new row inherits the previous
 * version's title, folder, audience, tags and required-reading flag; the
 * previous version is kept and marked superseded by the database.
 */
export async function addDocumentVersion(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;

  const parsed = versionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: previous } = await supabase
    .from("document")
    .select("id, title, description, superseded_at, archived_at")
    .eq("id", data.supersedesId)
    .maybeSingle();
  if (!previous) return { ok: false, error: "Document not found or not accessible." };
  if (previous.superseded_at || previous.archived_at) {
    return {
      ok: false,
      error: "A newer version already exists. Reload the page and replace the current version.",
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
      return { ok: false, error: "You can't add a version to this document." };
    }
    if (error?.code === "23514" && data.kind === "link") {
      return { ok: false, error: "That link is not from an approved source." };
    }
    if (error?.code === "23514" || error?.code === "23505") {
      return {
        ok: false,
        error: "A newer version already exists. Reload the page and replace the current version.",
      };
    }
    return { ok: false, error: "Could not save the new version." };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${previous.id}`);
  return { ok: true, id: doc.id as string };
}

const detailsSchema = z.object({
  documentId: z.string().uuid(),
  folderId: z
    .string()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(z.string().uuid().nullable()),
  tags: tagsSchema,
  requiresAcknowledgement: z.boolean().default(false),
});

/** Files a document in a folder, sets its tags and its required-reading flag. */
export async function updateDocumentDetails(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
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
          ? "Only staff can file into a staff folder or mark required reading."
          : "Only staff can file into a staff folder.",
      };
    }
    if (error.code === "23514") {
      return {
        ok: false,
        error: data.requiresAcknowledgement
          ? "Required reading must be a library document open to its folder's audience, not one linked to a project, program or meeting, and not restricted."
          : "That folder is not available.",
      };
    }
    return { ok: false, error: "Could not save the details." };
  }
  if (!updated?.length) {
    return { ok: false, error: "You can't change this document, or it has a newer version." };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${data.documentId}`);
  return { ok: true, id: data.documentId };
}

/** Records that the signed-in member has read a required document. */
export async function acknowledgeDocument(documentId: string): Promise<ActionResult> {
  const session = await requireSession();
  const id = z.string().uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: "Document not found." };

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
      error: "Could not record your confirmation. The document may have a newer version.",
    };
  }

  revalidatePath(`/documents/${id.data}`);
  revalidatePath("/documents");
  return { ok: true, id: id.data };
}

const folderSchema = z.object({
  category: z.enum(FOLDER_CATEGORIES.map((c) => c.id) as [string, ...string[]], {
    errorMap: () => ({ message: "Choose a category." }),
  }),
  name: requiredText("Give the folder a name.", 80),
  visibility: z.enum(["organization", "staff"]).default("organization"),
});

/** Creates a library folder. Administrators only, with MFA. */
export async function createDocumentFolder(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;

  const parsed = folderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
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
      return { ok: false, error: "A folder with that name already exists in this category." };
    }
    return { ok: false, error: "Could not create the folder." };
  }
  revalidatePath("/documents");
  return { ok: true, id: folder.id as string };
}
