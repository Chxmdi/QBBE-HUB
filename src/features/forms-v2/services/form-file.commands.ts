"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { registerUploadedDocument } from "@/features/documents/services/document.commands";
import { MAX_UPLOAD_BYTES } from "@/features/editor/adapter/files";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formsV2Text } from "@/features/forms-v2/messages";
import type { FormsV2Result } from "@/features/forms-v2/services/forms-v2.commands";

/**
 * Files answered on a form (U11). The browser puts the file in the
 * `documents` bucket (see FormV2Fill), then this records it as a library
 * document of the person's own, which queues the virus scan. The answer the
 * form stores is the document id; public.submit_form_v2 checks the document
 * is the submitter's. The `document:upload` rate limit is applied inside
 * registerUploadedDocument, once per file.
 *
 * A member may only register an organization-wide library file, so the file
 * is narrowed straight after to its uploader, owners, admins and leadership
 * viewers (public.form_v2_keep_file_private): the same people who read the
 * response it belongs to.
 */

const uploadSchema = z.object({
  storagePath: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.number().int().min(0),
});

export type FormFileScan = "pending" | "clean" | "quarantined" | "rejected";

export async function registerFormFile(
  input: unknown,
): Promise<FormsV2Result<{ documentId: string; title: string; scanStatus: FormFileScan }>> {
  const m = formsV2Text(await getLocale());
  if (!(await isEnabled("wos_forms_v2"))) return { ok: false, error: m.errors.forbidden };
  await requireSession();
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.fileUploadFailed };
  if (parsed.data.sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, error: m.errors.fileTooLarge };
  const result = await registerUploadedDocument({
    title: parsed.data.fileName,
    storagePath: parsed.data.storagePath,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    // The one visibility every member may register a library file with;
    // narrowed below.
    visibility: "organization",
  });
  if (!result.ok || !result.id) return { ok: false, error: result.error ?? m.errors.fileUploadFailed };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("form_v2_keep_file_private", { p_document_id: result.id });
  if (error) {
    // Never leave a form's file readable by the whole organization.
    await supabase.from("document").delete().eq("id", result.id);
    return { ok: false, error: m.errors.fileUploadFailed };
  }
  return { ok: true, data: { documentId: result.id, title: parsed.data.fileName, scanStatus: "pending" } };
}
