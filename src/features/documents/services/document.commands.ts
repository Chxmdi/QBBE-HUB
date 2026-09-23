"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";

const linkSchema = z.object({
  title: requiredText("Give the resource a title.", 200),
  // https only, and not merely "a valid URL". `new URL()` — which is what Zod's
  // `.url()` defers to — parses `javascript:alert(1)` and
  // `data:text/html,<script>…</script>` without complaint, and a link document's
  // stored URL is handed straight to `window.open` when somebody opens it.
  url: z
    .string()
    .trim()
    .url("Enter a valid URL.")
    .refine(
      (value) => /^https:\/\//i.test(value),
      "A resource link must be an https address.",
    ),
  description: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  visibility: z.enum(["organization", "staff"]).default("organization"),
});

/** Registers an external resource link (QBBE-controlled Drive, etc.). */
export async function createDocumentLink(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
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
    return { ok: false, error: "Enter a valid URL." };
  }

  const { data: approved, error: approvedError } = await supabase
    .from("approved_document_host")
    .select("host, label")
    .eq("organization_id", session.organizationId)
    .order("host");

  // A failed read is not an empty allowlist. Treating it as one would refuse
  // every link and blame the person's URL for it.
  if (approvedError) {
    return { ok: false, error: "Could not check the approved sources. Try again." };
  }

  if (!approved?.some((row) => row.host === host)) {
    const names = (approved ?? []).map((row) => row.label || row.host);
    return {
      ok: false,
      error: names.length
        ? `${host} is not an approved source. Links must point at ${names.join(", ")}.`
        : `${host} is not an approved source, and no approved sources are configured yet. An administrator can add one.`,
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
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !doc) return { ok: false, error: "Could not save the resource." };

  revalidatePath("/documents");
  return { ok: true, id: doc.id as string };
}

const fileSchema = z.object({
  title: z.string().trim().min(1).max(200),
  storagePath: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.coerce.number().int().min(0).optional(),
  description: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  visibility: z.enum(["organization", "staff"]).default("organization"),
});

/** Records an uploaded file after the client streams it into Storage. */
export async function registerUploadedDocument(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
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
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !doc) return { ok: false, error: "Could not record the upload." };

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
  const supabase = await createSupabaseServerClient();

  const { data: doc } = await supabase
    .from("document")
    .select("kind, url, storage_path, title, scan_status")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return { ok: false, error: "Document not found or not accessible." };
  if (doc.kind === "link") return { ok: true, url: doc.url as string };
  if (doc.scan_status !== "clean") {
    return { ok: false, error: "This file is still being checked or has been quarantined." };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path as string, 60);

  if (error || !signed) {
    return { ok: false, error: "Could not generate a download link." };
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
  const { error } = await supabase
    .from("document")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) return { ok: false, error: "Could not archive the document." };

  revalidatePath("/documents");
  return { ok: true };
}

export async function restoreDocument(documentId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("document")
    .update({ archived_at: null })
    .eq("id", documentId)
    .not("archived_at", "is", null);
  if (error) return { ok: false, error: "Could not restore the document." };
  revalidatePath("/documents");
  return { ok: true };
}
