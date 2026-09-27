"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireStaff } from "@/lib/auth";
import { requiredText } from "@/lib/schema";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  generatedTitle,
  mergeTemplate,
  placeholdersFor,
  unknownPlaceholders,
  type MergeValue,
  type RecordType,
  type TemplateLanguage,
} from "@/features/documents/templates/merge";
import { renderTextPdf } from "@/features/documents/templates/pdf";

// Templates (#147). Owners and admins with MFA write them (checked here for a
// clear message, and by row-level security underneath). Staff generate from
// them. Every record is read with the person's own session, so a record merges
// only if they could already read it; the output goes into the library through
// the same upload path as any file.

const templateSchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredText("Give the template a name.", 120),
  kind: z.enum(["letter", "contract", "acknowledgement"]),
  language: z.enum(["fr", "en"]),
  recordType: z.enum(["member", "contact", "gift"]),
  body: requiredText("Write the template's text.", 20000),
  folderId: z
    .string()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(z.string().uuid().nullable()),
});

export async function saveTemplate(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const { session } = authorization;

  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the template." };
  }
  const data = parsed.data;
  const unknown = unknownPlaceholders(data.body, data.recordType);
  if (unknown.length) {
    return {
      ok: false,
      error: `This template cannot fill ${unknown.map((n) => `{{${n}}}`).join(", ")}. Use only the fields listed for the record it merges.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const row = {
    name: data.name,
    kind: data.kind,
    language: data.language,
    record_type: data.recordType,
    body: data.body,
    folder_id: data.folderId,
  };
  const { data: saved, error } = data.id
    ? await supabase
        .from("document_template")
        .update(row)
        .eq("id", data.id)
        .is("archived_at", null)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("document_template")
        .insert({ ...row, organization_id: session.organizationId })
        .select("id")
        .single();

  if (error?.code === "23505") return { ok: false, error: "A template with that name already exists." };
  if (error?.code === "42501") return { ok: false, error: "Only owners and admins with MFA manage templates." };
  if (error || !saved) return { ok: false, error: "Could not save the template." };

  revalidatePath("/documents/templates");
  return { ok: true, id: saved.id as string };
}

export async function archiveTemplate(templateId: string): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Template not found." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("document_template")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", templateId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not archive the template." };
  revalidatePath("/documents/templates");
  return { ok: true, id: templateId };
}

const generateSchema = z.object({
  templateId: z.string().uuid(),
  recordId: z.string().uuid(),
  folderId: z
    .string()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(z.string().uuid().nullable()),
});

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Merge = { label: string; values: Record<string, MergeValue> };

const ROLE_NAMES: Record<TemplateLanguage, Record<string, string>> = {
  en: {
    owner: "Owner",
    admin: "Administrator",
    leadership_viewer: "Leadership",
    staff: "Staff",
    volunteer: "Volunteer",
    guest: "Guest",
  },
  fr: {
    owner: "Propriétaire",
    admin: "Administrateur",
    leadership_viewer: "Direction",
    staff: "Personnel",
    volunteer: "Bénévole",
    guest: "Invité",
  },
};

const text = (value: unknown): MergeValue => ({
  kind: "text",
  value: typeof value === "string" ? value : value == null ? null : String(value),
});

/** Reads one record with the person's own session; null when they cannot. */
async function recordValues(
  supabase: Supabase,
  organizationId: string,
  recordType: RecordType,
  recordId: string,
  language: TemplateLanguage,
): Promise<Merge | null> {
  if (recordType === "member") {
    const { data } = await supabase
      .from("organization_membership")
      .select("role, joined_at, profile:user_id(full_name, email, title)")
      .eq("organization_id", organizationId)
      .eq("user_id", recordId)
      .eq("status", "active")
      .maybeSingle();
    const profile = (data?.profile ?? null) as unknown as
      | { full_name: string; email: string; title: string | null }
      | null;
    if (!data || !profile) return null;
    return {
      label: profile.full_name || profile.email,
      values: {
        "person.name": text(profile.full_name),
        "person.email": text(profile.email),
        "person.title": text(profile.title),
        "person.role": text(ROLE_NAMES[language][data.role as string] ?? data.role),
        "person.joined_on": { kind: "date", value: (data.joined_at as string)?.slice(0, 10) },
      },
    };
  }
  if (recordType === "contact") {
    const { data } = await supabase
      .from("crm_contact")
      .select("full_name, email, role_title, crm_org:crm_organization_id(name)")
      .eq("organization_id", organizationId)
      .eq("id", recordId)
      .maybeSingle();
    if (!data) return null;
    const crmOrg = data.crm_org as unknown as { name: string } | null;
    return {
      label: data.full_name as string,
      values: {
        "contact.name": text(data.full_name),
        "contact.email": text(data.email),
        "contact.title": text(data.role_title),
        "contact.organization": text(crmOrg?.name),
      },
    };
  }
  const { data } = await supabase
    .from("gift")
    .select(
      "gift_number, received_on, amount_cents, in_kind_description, status, " +
        "contact:crm_contact_id(full_name), donor_org:crm_organization_id(name)",
    )
    .eq("organization_id", organizationId)
    .eq("id", recordId)
    .maybeSingle();
  const gift = data as unknown as {
    gift_number: number;
    received_on: string;
    amount_cents: number | string | null;
    in_kind_description: string | null;
    status: string;
    contact: { full_name: string } | null;
    donor_org: { name: string } | null;
  } | null;
  if (!gift || gift.status !== "recorded") return null;
  const donor = gift.contact?.full_name ?? gift.donor_org?.name ?? "";
  return {
    label: `${donor} (${language === "fr" ? "don" : "gift"} ${gift.gift_number})`,
    values: {
      "donor.name": text(donor),
      "gift.number": text(gift.gift_number),
      // bigint arrives as a string or a number; either way it is whole cents.
      "gift.amount": { kind: "money", cents: gift.amount_cents == null ? null : Number(gift.amount_cents) },
      "gift.date": { kind: "date", value: gift.received_on },
      "gift.description": text(gift.in_kind_description),
    },
  };
}

/**
 * Generates a document from a template and one record, and files it in the
 * library as a new PDF. Returns the new document's id.
 */
export async function generateFromTemplate(input: unknown): Promise<ActionResult> {
  const session = await requireStaff();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose a template and a record." };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: template } = await supabase
    .from("document_template")
    .select("id, name, kind, language, record_type, body, folder_id")
    .eq("id", data.templateId)
    .is("archived_at", null)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found or not available." };

  const language = template.language as TemplateLanguage;
  const recordType = template.record_type as RecordType;
  const record = await recordValues(supabase, session.organizationId, recordType, data.recordId, language);
  if (!record) return { ok: false, error: "That record was not found, or you cannot read it." };

  const { data: org } = await supabase
    .from("organization")
    .select("name")
    .eq("id", session.organizationId)
    .maybeSingle();
  const values: Record<string, MergeValue> = {
    ...record.values,
    today: { kind: "date", value: new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }) },
    "organization.name": text(org?.name),
  };

  let body: string;
  try {
    body = mergeTemplate(template.body as string, values, language, placeholdersFor(recordType));
  } catch {
    return { ok: false, error: "This template uses a field it cannot fill. An administrator can correct it." };
  }
  const title = generatedTitle(template.name as string, record.label);
  const pdf = renderTextPdf({ title, text: body });

  const safeName =
    title
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "document";
  const path = `${crypto.randomUUID()}/${safeName}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, pdf, { contentType: "application/pdf" });
  if (uploadError) return { ok: false, error: "Could not save the generated file. Try again." };

  const { data: doc, error } = await supabase
    .from("document")
    .insert({
      organization_id: session.organizationId,
      title,
      kind: "file",
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      // Who can open it is decided by the folder: a staff folder narrows it
      // to staff (the template's default folder for anything confidential).
      visibility: "organization",
      folder_id: data.folderId ?? (template.folder_id as string | null),
      tags: [template.kind as string],
      template_id: template.id,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !doc) {
    await supabase.storage.from("documents").remove([path]);
    return {
      ok: false,
      error:
        error?.code === "42501"
          ? "You cannot file into that folder."
          : "Could not save the generated document.",
    };
  }

  // The merged text is known exactly, so it is stored for search directly.
  await supabase.rpc("set_document_text", {
    p_document: doc.id,
    p_text: body,
    p_source: "generated",
  });

  revalidatePath("/documents");
  return { ok: true, id: doc.id as string };
}
