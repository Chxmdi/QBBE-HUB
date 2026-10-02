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
import {
  buildBody,
  buildPageBody,
  isCalendarDate,
  type DraftBlock,
  type DraftTask,
  type PageBody,
  type TemplateTypeKey,
} from "@/features/templates-v2/template";

export type TemplatesV2Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// What the builder sends, checked before it is read: a Server Action is a
// public endpoint and the browser's types do not travel with the request.
const bilingual = z.object({ en: z.string().max(5000), fr: z.string().max(5000) });
const createSchema = z.object({
  typeKey: z.enum(["task", "project", "page"]),
  name: bilingual,
  description: bilingual,
  title: bilingual,
  duration: z.string().max(20),
  tasks: z.array(z.object({ en: z.string().max(2000), fr: z.string().max(2000), due: z.string().max(20) })).max(200),
  /** A page template's rows (U8). */
  blocks: z
    .array(
      z.object({
        kind: z.enum(["heading", "paragraph", "todo"]),
        en: z.string().max(5000),
        fr: z.string().max(5000),
        due: z.string().max(20),
      }),
    )
    .max(500)
    .optional(),
  publish: z.boolean(),
});

async function messages() {
  return templatesV2Text(await getLocale());
}

const uuid = z.string().uuid();

export async function applyTemplateV2(input: {
  templateId: string;
  start: string;
  locale: "en" | "fr-CA";
  programId: string | null;
  projectId: string | null;
}): Promise<TemplatesV2Result<{ created: { type: string; id: string }[] }>> {
  const m = await messages();
  if (!(await isEnabled(TEMPLATES_FLAG))) return { ok: false, error: m.errors.forbidden };
  const session = await requireSession();
  const limited = await enforceRateLimit("template:write", session.userId);
  if (limited) return limited;
  if (!uuid.safeParse(input.templateId).success) return { ok: false, error: m.errors.unavailable };
  if (!isCalendarDate(input.start)) return { ok: false, error: m.errors.startDate };
  for (const id of [input.programId, input.projectId]) {
    if (id !== null && !uuid.safeParse(id).success) return { ok: false, error: m.errors.destination };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_template_v2", {
    p_template_id: input.templateId,
    p_start: input.start,
    p_locale: input.locale === "fr-CA" ? "fr-CA" : "en",
    p_program_id: input.programId,
    p_project_id: input.projectId,
  });
  if (error) {
    // The person's own insert rules refused: say so plainly rather than "error".
    if (error.code === "42501" && /row-level security|violates/i.test(error.message)) {
      return { ok: false, error: m.errors.notAllowed };
    }
    return { ok: false, error: error.code === "42501" ? m.errors.unavailable : m.errors.generic };
  }
  const rows = (data ?? []) as { object_type: string; object_id: string }[];
  revalidatePath("/projects");
  return { ok: true, data: { created: rows.map((r) => ({ type: r.object_type, id: r.object_id })) } };
}

const calendarDate = z.string().refine(isCalendarDate);

const applyPageSchema = z.object({
  templateId: uuid,
  /** Null puts the page at the top of the workspace. */
  parentPageId: uuid.nullable(),
  title: z.string().trim().max(500),
  start: calendarDate,
  locale: z.enum(["en", "fr-CA"]),
  variables: z.object({
    program: z.string().trim().max(500).optional(),
    owner: z.string().trim().max(500).optional(),
    period: z.string().trim().max(500).optional(),
    due: z.union([calendarDate, z.literal("")]).optional(),
  }),
  /** Where a hub template's project goes (T1); null outside any program. */
  programId: uuid.nullable().optional(),
});

export type ApplyPageTemplateInput = z.infer<typeof applyPageSchema>;

/**
 * Creates a page from a page template (U8). The database function runs as
 * the person, so the page insert rule decides where they may create one;
 * this only shapes the input and turns a refusal into a sentence.
 */
export async function applyPageTemplateV2(input: unknown): Promise<TemplatesV2Result<{ pageId: string }>> {
  const m = await messages();
  if (!(await isEnabled(TEMPLATES_FLAG))) return { ok: false, error: m.errors.forbidden };
  if (!(await isEnabled("wos_pages"))) return { ok: false, error: m.errors.pagesOff };
  const session = await requireSession();
  const parsed = applyPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.generic };
  const limited = await enforceRateLimit("page:create", session.userId);
  if (limited) return limited;
  const { templateId, parentPageId, title, start, locale, variables, programId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  // Someone in two organizations sees both galleries; a page is made only in
  // the organization they are working in, as createPage does.
  const { data: owner } = await supabase.from("template_v2").select("organization_id").eq("id", templateId).maybeSingle();
  if (!owner || owner.organization_id !== session.organizationId) return { ok: false, error: m.errors.unavailable };
  const { data, error } = await supabase.rpc("apply_page_template_v2", {
    p_template: templateId,
    p_parent: parentPageId,
    p_title: title,
    p_start: start,
    p_variables: { ...variables, locale },
    p_program: programId ?? null,
  });
  if (error) {
    // A hub's project, milestones or tasks were refused (T1): say which part.
    if (error.code === "42501" && /table "(project|milestone|task)"/i.test(error.message)) {
      return { ok: false, error: m.errors.hubNotAllowed };
    }
    if (error.code === "42501" && /row-level security|violates/i.test(error.message)) {
      return { ok: false, error: m.errors.pageNotAllowed };
    }
    if (error.code === "P0002") return { ok: false, error: m.errors.parentGone };
    if (error.code === "42501" || error.code === "0A000") return { ok: false, error: m.errors.unavailable };
    if (error.code === "22023") return { ok: false, error: m.errors.startDate };
    return { ok: false, error: m.errors.generic };
  }
  if (typeof data !== "string") return { ok: false, error: m.errors.generic };
  revalidatePath("/pages", "layout");
  return { ok: true, data: { pageId: data } };
}

export interface PageTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  body: PageBody;
}

/**
 * The published page templates of the reader's organization, named in their
 * language, for the pages sidebar; null while templates are switched off.
 */
export async function listPageTemplatesV2(): Promise<PageTemplateSummary[] | null> {
  if (!(await isEnabled(TEMPLATES_FLAG)) || !(await isEnabled("wos_pages"))) return null;
  const session = await requireSession();
  const fr = (await getLocale()) === "fr-CA";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("template_v2")
    .select("id, name_en, name_fr, description_en, description_fr, body")
    .eq("organization_id", session.organizationId)
    .eq("scope", "page")
    .eq("status", "published")
    .order(fr ? "name_fr" : "name_en")
    .limit(200);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (fr ? row.name_fr : row.name_en) as string,
    description: ((fr ? row.description_fr : row.description_en) as string | null) ?? null,
    body: row.body as PageBody,
  }));
}

export async function createTemplateV2(input: {
  typeKey: TemplateTypeKey | "page";
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  title: { en: string; fr: string };
  duration: string;
  tasks: DraftTask[];
  blocks?: DraftBlock[];
  publish: boolean;
}): Promise<TemplatesV2Result<{ id: string }>> {
  const m = await messages();
  if (!(await isEnabled(TEMPLATES_FLAG))) return { ok: false, error: m.errors.forbidden };
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: m.errors.forbidden };
  const limited = await enforceRateLimit("template:write", session.userId);
  if (limited) return limited;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.generic };
  const draft = parsed.data;
  const name = { en: draft.name.en.trim().slice(0, 200), fr: draft.name.fr.trim().slice(0, 200) };
  if (!name.en || !name.fr) return { ok: false, error: m.errors.name };
  const built =
    draft.typeKey === "page"
      ? buildPageBody(draft.title, draft.blocks ?? [])
      : buildBody(draft.typeKey, draft.title, draft.duration, draft.tasks.slice(0, 200));
  if (!built.ok) return { ok: false, error: m.errors[built.problem] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("template_v2")
    .insert({
      organization_id: session.organizationId,
      scope: draft.typeKey === "page" ? "page" : "object",
      type_key: draft.typeKey === "page" ? null : draft.typeKey,
      name_en: name.en,
      name_fr: name.fr,
      description_en: draft.description.en.trim().slice(0, 2000) || null,
      description_fr: draft.description.fr.trim().slice(0, 2000) || null,
      body: built.body,
      status: draft.publish ? "published" : "draft",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: m.errors.generic };
  revalidatePath("/templates-v2");
  return { ok: true, data: { id: data.id as string } };
}
