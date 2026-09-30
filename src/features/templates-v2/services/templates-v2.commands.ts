"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TEMPLATES_FLAG } from "@/features/templates-v2/gate";
import { templatesV2Text } from "@/features/templates-v2/messages";
import { buildBody, isCalendarDate, type DraftTask, type TemplateTypeKey } from "@/features/templates-v2/template";

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

export async function createTemplateV2(input: {
  typeKey: TemplateTypeKey;
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  title: { en: string; fr: string };
  duration: string;
  tasks: DraftTask[];
  publish: boolean;
}): Promise<TemplatesV2Result<{ id: string }>> {
  const m = await messages();
  if (!(await isEnabled(TEMPLATES_FLAG))) return { ok: false, error: m.errors.forbidden };
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: m.errors.forbidden };
  if (input.typeKey !== "task" && input.typeKey !== "project") return { ok: false, error: m.errors.generic };
  const name = { en: input.name.en.trim().slice(0, 200), fr: input.name.fr.trim().slice(0, 200) };
  if (!name.en || !name.fr) return { ok: false, error: m.errors.name };
  const built = buildBody(input.typeKey, input.title, input.duration, input.tasks.slice(0, 200));
  if (!built.ok) return { ok: false, error: m.errors[built.problem] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("template_v2")
    .insert({
      organization_id: session.organizationId,
      scope: "object",
      type_key: input.typeKey,
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
