"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMPLATES_FLAG } from "@/features/templates-v2/gate";
import { templatesV2Text } from "@/features/templates-v2/messages";
import { buildHub, documentVariables, type PageBody, type PageDocument } from "@/features/templates-v2/template";

/**
 * Templates that build hubs, with versions (T1), behind the `wos_pages`
 * switch: editing a page template in the real editor (each save is a new
 * version, numbered by the database), duplicating a template without its
 * private references, and the versions list. Row-level security decides
 * every read and write; these only shape input and word refusals.
 */

export type TemplateVersionsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const uuid = z.string().uuid();

async function gate() {
  const m = templatesV2Text(await getLocale());
  if (!(await isEnabled(TEMPLATES_FLAG)) || !(await isEnabled("wos_pages"))) return { m, off: true as const };
  return { m, off: false as const };
}

export interface TemplateVersionRow {
  version: number;
  createdAt: string;
  /** Pages made from this version that the reader can open. */
  pages: number;
}

export interface TemplateDetails {
  version: number;
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  canEdit: boolean;
  canDuplicate: boolean;
  versions: TemplateVersionRow[];
}

/** The template's versions, newest first, and what the reader may do with it. */
export async function templateDetailsV2(templateId: unknown): Promise<TemplateVersionsResult<TemplateDetails>> {
  const { m, off } = await gate();
  if (off) return { ok: false, error: m.errors.pagesOff };
  const session = await requireSession();
  const id = uuid.safeParse(templateId);
  if (!id.success) return { ok: false, error: m.errors.unavailable };
  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .from("template_v2")
    .select("id, version, created_by, organization_id, name_en, name_fr, description_en, description_fr")
    .eq("id", id.data)
    .maybeSingle();
  if (error) return { ok: false, error: m.errors.generic };
  if (!template) return { ok: false, error: m.errors.unavailable };
  const [{ data: versions, error: versionsError }, { data: origins, error: originsError }] = await Promise.all([
    supabase
      .from("template_v2_version")
      .select("version, created_at")
      .eq("template_id", id.data)
      .order("version", { ascending: false })
      .limit(200),
    supabase.from("page_template_origin").select("template_version").eq("template_id", id.data).limit(5000),
  ]);
  if (versionsError || originsError) return { ok: false, error: m.errors.generic };
  const counts = new Map<number, number>();
  for (const row of origins ?? []) counts.set(row.template_version as number, (counts.get(row.template_version as number) ?? 0) + 1);
  const sameOrganization = template.organization_id === session.organizationId;
  return {
    ok: true,
    data: {
      version: template.version as number,
      name: { en: template.name_en as string, fr: template.name_fr as string },
      description: { en: (template.description_en as string | null) ?? "", fr: (template.description_fr as string | null) ?? "" },
      // The update rule: the author while staff, or an admin. The database decides again on save.
      canEdit: sameOrganization && (session.isAdmin || (session.isStaff && template.created_by === session.userId)),
      canDuplicate: session.isStaff,
      versions: (versions ?? []).map((v) => ({
        version: v.version as number,
        createdAt: v.created_at as string,
        pages: counts.get(v.version as number) ?? 0,
      })),
    },
  };
}

const bilingual = (max: number) => z.object({ en: z.string().max(max), fr: z.string().max(max) });
/** Blocks are checked by the database against the editor's registry; here only their size. */
const blocks = z.array(z.object({ type: z.string().max(60) }).passthrough()).max(500);
const draftRow = z.object({ en: z.string().max(200), fr: z.string().max(200), due: z.string().max(20) });
const updateSchema = z.object({
  id: uuid,
  name: bilingual(200),
  description: bilingual(2000),
  title: bilingual(200),
  document: z.object({ en: blocks, fr: blocks }),
  milestones: z.array(draftRow).max(50),
  tasks: z.array(draftRow.extend({ milestone: z.string().max(3) })).max(200),
});

export type UpdatePageTemplateInput = z.infer<typeof updateSchema>;

const MAX_DOCUMENT_BYTES = 1_000_000;

/** Saves a page template edited in the real editor; the database makes it the next version. */
export async function updatePageTemplateV2(input: unknown): Promise<TemplateVersionsResult<{ version: number }>> {
  const { m, off } = await gate();
  if (off) return { ok: false, error: m.errors.pagesOff };
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: m.errors.forbidden };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.generic };
  const limited = await enforceRateLimit("template:write", session.userId);
  if (limited) return limited;
  const draft = parsed.data;
  const name = { en: draft.name.en.trim(), fr: draft.name.fr.trim() };
  const title = { en: draft.title.en.trim() || name.en, fr: draft.title.fr.trim() || name.fr };
  if (!name.en || !name.fr) return { ok: false, error: m.errors.name };
  const document = draft.document as PageDocument;
  if (document.en.length + document.fr.length === 0) return { ok: false, error: m.errors.blocks };
  if (JSON.stringify(document).length > MAX_DOCUMENT_BYTES) return { ok: false, error: m.errors.tooLarge };
  const hub = buildHub(draft.milestones, draft.tasks);
  if (!hub.ok) return { ok: false, error: m.errors[hub.problem] };
  const variables = documentVariables(document);
  const body: PageBody = {
    title,
    blocks: [],
    document,
    ...(variables.length > 0 ? { variables } : {}),
    ...(hub.hub ? { hub: hub.hub } : {}),
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("template_v2")
    .update({
      name_en: name.en,
      name_fr: name.fr,
      description_en: draft.description.en.trim() || null,
      description_fr: draft.description.fr.trim() || null,
      body,
    })
    .eq("id", draft.id)
    .eq("scope", "page")
    .select("version")
    .maybeSingle();
  if (error) return { ok: false, error: error.code === "23514" ? m.errors.document : m.errors.generic };
  if (!data) return { ok: false, error: m.errors.forbidden };
  revalidatePath(`/templates-v2/${draft.id}`);
  return { ok: true, data: { version: data.version as number } };
}

/** Copies a template the reader can see into their organization, as their draft, without private references. */
export async function duplicateTemplateV2(templateId: unknown): Promise<TemplateVersionsResult<{ id: string }>> {
  const { m, off } = await gate();
  if (off) return { ok: false, error: m.errors.pagesOff };
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: m.errors.forbidden };
  const id = uuid.safeParse(templateId);
  if (!id.success) return { ok: false, error: m.errors.unavailable };
  const limited = await enforceRateLimit("template:write", session.userId);
  if (limited) return limited;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_template_v2", {
    p_template: id.data,
    p_organization: session.organizationId,
  });
  if (error) {
    if (error.code === "42501" && /row-level security|violates/i.test(error.message)) return { ok: false, error: m.errors.forbidden };
    return { ok: false, error: error.code === "42501" ? m.errors.unavailable : m.errors.generic };
  }
  if (typeof data !== "string") return { ok: false, error: m.errors.generic };
  revalidatePath("/templates-v2");
  return { ok: true, data: { id: data } };
}

export interface HubPrograms {
  programs: { id: string; name: string }[];
  /** Admins may put the hub's project outside any program. */
  outsideProgram: boolean;
}

/** The programs the reader can see, for a hub's project; the project insert rule decides on use. */
export async function listHubProgramsV2(): Promise<TemplateVersionsResult<HubPrograms>> {
  const { m, off } = await gate();
  if (off) return { ok: false, error: m.errors.pagesOff };
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("program")
    .select("id, name")
    .eq("organization_id", session.organizationId)
    .order("name")
    .limit(500);
  if (error) return { ok: false, error: m.errors.generic };
  return {
    ok: true,
    data: { programs: (data ?? []) as { id: string; name: string }[], outsideProgram: session.isAdmin },
  };
}
