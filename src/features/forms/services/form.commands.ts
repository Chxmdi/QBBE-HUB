"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { getLocale, getT } from "@/lib/i18n/server";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";
import {
  FIELD_TYPES,
  MAX_FIELDS,
  assignFieldKeys,
  parseAnswers,
  type FormField,
} from "@/features/forms/fields";

const fieldSchema = z
  .object({
    label: requiredText("forms.errors.fieldLabel" satisfies MessageKey, 200),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    help: z.string().trim().max(500).optional(),
  })
  .transform((f) => ({
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.type === "choice" ? { options: [...new Set(f.options ?? [])] } : {}),
    ...(f.help ? { help: f.help } : {}),
  }))
  .refine((f) => f.type !== "choice" || (f.options?.length ?? 0) > 0, {
    message: "forms.errors.choiceOption" satisfies MessageKey,
  });

const formSchema = z.object({
  title: requiredText("forms.errors.title" satisfies MessageKey, 200),
  description: z.string().trim().max(2000).optional(),
  audience: z.enum(["members", "staff"]).default("members"),
  requiresSignature: z.boolean().default(false),
  fields: z
    .array(fieldSchema)
    .min(1, "forms.errors.addField" satisfies MessageKey)
    .max(MAX_FIELDS, "forms.errors.maxFields" satisfies MessageKey),
});

/**
 * The schema messages above are catalogue keys; this reads one in the
 * request's language. Zod's own wording is not a key and passes through.
 */
async function issueText(message: string | undefined): Promise<string> {
  const t = await getT();
  return message ? t(message as MessageKey, { max: MAX_FIELDS }) : t("forms.errors.check");
}

function formRow(data: z.infer<typeof formSchema>) {
  return {
    title: data.title,
    description: data.description || null,
    audience: data.audience,
    requires_signature: data.requiresSignature,
    fields: assignFieldKeys(data.fields),
  };
}

async function audit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  session: { organizationId: string; userId: string },
  action: string,
  objectType: string,
  objectId: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "forms",
    action,
    object_type: objectType,
    object_id: objectId,
    metadata,
  });
}

/** Saves a new form as a draft. Owners and admins with MFA only. */
export async function createForm(input: unknown): Promise<ActionResult> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await issueText(parsed.error.issues[0]?.message) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("form_definition")
    .insert({ organization_id: auth.session.organizationId, ...formRow(parsed.data) })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: (await getT())("forms.errors.saveFailed") };
  await audit(supabase, auth.session, "form_created", "form_definition", data.id);
  revalidatePath("/forms");
  return { ok: true, id: data.id as string };
}

/** Replaces a draft's questions. Published forms are frozen by the database. */
export async function updateDraftForm(formId: string, input: unknown): Promise<ActionResult> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(formId).success) return { ok: false, error: (await getT())("forms.errors.notFound") };
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: await issueText(parsed.error.issues[0]?.message) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("form_definition")
    .update(formRow(parsed.data))
    .eq("id", formId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: (await getT())("forms.errors.onlyDraftEdit") };
  }
  await audit(supabase, auth.session, "form_updated", "form_definition", formId);
  revalidatePath(`/forms/${formId}`);
  return { ok: true, id: formId };
}

const STATUS_ACTIONS = {
  published: "form_published",
  closed: "form_closed",
} as const;

/** Publish a draft, close a published form, or reopen a closed one. */
export async function setFormStatus(
  formId: string,
  status: "published" | "closed",
): Promise<ActionResult> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(formId).success || !(status in STATUS_ACTIONS)) {
    return { ok: false, error: (await getT())("forms.errors.notFound") };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("form_definition")
    .update({ status })
    .eq("id", formId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      error: error?.code === "23514" ? error.message : (await getT())("forms.errors.changeFailed"),
    };
  }
  await audit(supabase, auth.session, STATUS_ACTIONS[status], "form_definition", formId);
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return { ok: true, id: formId };
}

export async function deleteDraftForm(formId: string): Promise<ActionResult> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(formId).success) return { ok: false, error: (await getT())("forms.errors.notFound") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("form_definition")
    .delete()
    .eq("id", formId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: (await getT())("forms.errors.onlyDraftDelete") };
  await audit(supabase, auth.session, "form_draft_deleted", "form_definition", formId);
  revalidatePath("/forms");
  return { ok: true, id: formId };
}

const submitSchema = z.object({
  formId: z.string().uuid(),
  answers: z.record(z.unknown()).default({}),
  signerName: z.string().trim().max(200).optional(),
  consent: z.boolean().default(false),
});

/**
 * Submits a form, signing it in the same transaction when the form asks for
 * a signature. Who, when and the content hash are recorded by the database,
 * which also writes the audit events.
 */
export async function submitForm(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("form:submit", session.userId);
  if (limited) return limited;
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getT())("forms.errors.notFound") };

  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("form_definition")
    .select("id, status, fields, requires_signature")
    .eq("id", parsed.data.formId)
    .maybeSingle();
  if (!form || form.status !== "published") {
    return { ok: false, error: (await getT())("forms.errors.notOpen") };
  }
  const answers = parseAnswers(
    form.fields as FormField[],
    parsed.data.answers,
    createTranslator(await getLocale()),
  );
  if (!answers.ok) return answers;
  if (form.requires_signature && (!parsed.data.signerName || !parsed.data.consent)) {
    return { ok: false, error: (await getT())("forms.errors.signRequired") };
  }

  const { data: id, error } = await supabase.rpc("submit_form", {
    p_form_id: form.id,
    p_answers: answers.answers,
    p_signer_name: form.requires_signature ? parsed.data.signerName : null,
    p_consent: form.requires_signature ? parsed.data.consent : false,
  });
  if (error || !id) {
    return {
      ok: false,
      error:
        error?.code === "23514" || error?.code === "22023"
          ? error.message
          : (await getT())("forms.errors.submitFailed"),
    };
  }
  revalidatePath("/forms");
  return { ok: true, id: id as string };
}

/** A one-minute link to an attachment, only once it has been scanned clean. */
export async function openFormFile(fileId: string): Promise<ActionResult & { url?: string }> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(fileId).success) return { ok: false, error: (await getT())("forms.errors.fileNotFound") };
  const supabase = await createSupabaseServerClient();
  const { data: file } = await supabase
    .from("form_file")
    .select("id, storage_path, scan_status")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { ok: false, error: (await getT())("forms.errors.fileNotAccessible") };
  if (file.scan_status !== "clean") {
    return { ok: false, error: (await getT())("forms.errors.fileChecking") };
  }
  const { data: signed, error } = await supabase.storage
    .from("form-files")
    .createSignedUrl(file.storage_path as string, 60);
  if (error || !signed) return { ok: false, error: (await getT())("forms.errors.openFailed") };
  await audit(supabase, session, "form_file_opened", "form_file", fileId);
  return { ok: true, url: signed.signedUrl };
}
