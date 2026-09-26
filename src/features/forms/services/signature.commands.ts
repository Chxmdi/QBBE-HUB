"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const documentSchema = z.object({
  title: requiredText("Give the document a title.", 200),
  message: z.string().trim().max(2000).optional(),
  storagePath: requiredText("Upload the PDF first.", 500),
  fileName: requiredText("Upload the PDF first.", 200),
  signerIds: z.array(z.string().uuid()).min(1, "Choose at least one person to sign.").max(50),
});

/**
 * Records a PDF the browser has put in the signing-documents bucket and the
 * people asked to sign it. Owners and admins with MFA only. The PDF's hash is
 * computed later from its bytes by the scanning job, never taken from here.
 */
export async function createSigningDocument(input: unknown): Promise<ActionResult> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the document details." };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const signerIds = [...new Set(data.signerIds)];
  const { data: id, error } = await supabase.rpc("send_for_signature", {
    p_organization_id: auth.session.organizationId,
    p_title: data.title,
    p_message: data.message ?? "",
    p_storage_path: data.storagePath,
    p_file_name: data.fileName,
    p_signer_ids: signerIds,
  });
  if (error || !id) {
    return {
      ok: false,
      error:
        error?.code === "23514"
          ? "Only active members of the organization can be asked to sign."
          : "Could not save the document. Try again.",
    };
  }
  await supabase.from("audit_event").insert({
    organization_id: auth.session.organizationId,
    actor_id: auth.session.userId,
    event_type: "signature",
    action: "document_sent_for_signature",
    object_type: "signing_document",
    object_id: id,
    metadata: { signers: signerIds.length },
  });
  revalidatePath("/signatures");
  return { ok: true, id: id as string };
}

const signSchema = z.object({
  documentId: z.string().uuid(),
  signerName: requiredText("Type your full name to sign.", 200),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Tick the consent box to sign." }),
  }),
});

/**
 * Signs a document. The database sets the signer, time, consent wording and
 * the document's hash, refuses anyone not asked to sign, and writes the
 * audit event.
 */
export async function signDocument(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("form:submit", session.userId);
  if (limited) return limited;
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check your signature." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("signature")
    .insert({
      organization_id: session.organizationId,
      signing_document_id: parsed.data.documentId,
      signer_id: session.userId,
      signer_name: parsed.data.signerName,
      consent_given: true,
      // Placeholders: the database writes the real values.
      consent_statement: "",
      content_sha256: "0".repeat(64),
    })
    .select("id")
    .single();
  if (error || !data) {
    const message =
      error?.code === "23505"
        ? "You have already signed this document."
        : error?.code === "55000"
          ? "The document can be signed once its security check has passed."
          : error?.code === "42501"
            ? "You are not asked to sign this document."
            : "Could not record your signature. Try again.";
    return { ok: false, error: message };
  }
  revalidatePath(`/signatures/${parsed.data.documentId}`);
  revalidatePath("/signatures");
  return { ok: true, id: data.id as string };
}

/** A one-minute link to the PDF, only once it has been scanned clean. */
export async function openSigningDocument(
  documentId: string,
): Promise<ActionResult & { url?: string }> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(documentId).success) return { ok: false, error: "Document not found." };
  const supabase = await createSupabaseServerClient();
  const { data: doc } = await supabase
    .from("signing_document")
    .select("id, storage_path, scan_status")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found or not accessible." };
  if (doc.scan_status !== "clean") {
    return { ok: false, error: "This file is still being checked or has been quarantined." };
  }
  const { data: signed, error } = await supabase.storage
    .from("signing-documents")
    .createSignedUrl(doc.storage_path as string, 60);
  if (error || !signed) return { ok: false, error: "Could not open the file." };
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "signature",
    action: "signing_document_opened",
    object_type: "signing_document",
    object_id: documentId,
  });
  return { ok: true, url: signed.signedUrl };
}
