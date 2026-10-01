"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
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
  await requireSession();
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
  const { templateId, parentPageId, title, start, locale, variables } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("apply_page_template_v2", {
    p_template: templateId,
    p_parent: parentPageId,
    p_title: title,
    p_start: start,
    p_variables: { ...variables, locale },
  });
  if (error) {
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

/** The published page templates, named in the reader's language, for the pages sidebar. */
export async function listPageTemplatesV2(): Promise<PageTemplateSummary[]> {
  if (!(await isEnabled(TEMPLATES_FLAG)) || !(await isEnabled("wos_pages"))) return [];
  await requireSession();
  const fr = (await getLocale()) === "fr-CA";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("template_v2")
    .select("id, name_en, name_fr, description_en, description_fr, body")
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
  if (input.typeKey !== "task" && input.typeKey !== "project" && input.typeKey !== "page") {
    return { ok: false, error: m.errors.generic };
  }
  const name = { en: input.name.en.trim().slice(0, 200), fr: input.name.fr.trim().slice(0, 200) };
  if (!name.en || !name.fr) return { ok: false, error: m.errors.name };
  const built =
    input.typeKey === "page"
      ? buildPageBody(
          input.title,
          (input.blocks ?? []).slice(0, 500).filter((b) => ["heading", "paragraph", "todo"].includes(b.kind)),
        )
      : buildBody(input.typeKey, input.title, input.duration, input.tasks.slice(0, 200));
  if (!built.ok) return { ok: false, error: m.errors[built.problem] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("template_v2")
    .insert({
      organization_id: session.organizationId,
      scope: input.typeKey === "page" ? "page" : "object",
      type_key: input.typeKey === "page" ? null : input.typeKey,
      name_en: name.en,
      name_fr: name.fr,
      description_en: input.description.en.trim().slice(0, 2000) || null,
      description_fr: input.description.fr.trim().slice(0, 2000) || null,
      body: built.body,
      status: input.publish ? "published" : "draft",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: m.errors.generic };
  revalidatePath("/templates-v2");
  return { ok: true, data: { id: data.id as string } };
}
