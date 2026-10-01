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
import { buildBody, isCalendarDate, type DraftTask, type TemplateTypeKey } from "@/features/templates-v2/template";

export type TemplatesV2Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

// What the builder sends, checked before it is read: a Server Action is a
// public endpoint and the browser's types do not travel with the request.
const bilingual = z.object({ en: z.string().max(5000), fr: z.string().max(5000) });
const createSchema = z.object({
  typeKey: z.enum(["task", "project"]),
  name: bilingual,
  description: bilingual,
  title: bilingual,
  duration: z.string().max(20),
  tasks: z.array(z.object({ en: z.string().max(2000), fr: z.string().max(2000), due: z.string().max(20) })).max(200),
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
  const limited = await enforceRateLimit("template:write", session.userId);
  if (limited) return limited;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.generic };
  const draft = parsed.data;
  const name = { en: draft.name.en.trim().slice(0, 200), fr: draft.name.fr.trim().slice(0, 200) };
  if (!name.en || !name.fr) return { ok: false, error: m.errors.name };
  const built = buildBody(draft.typeKey, draft.title, draft.duration, draft.tasks.slice(0, 200));
  if (!built.ok) return { ok: false, error: m.errors[built.problem] };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("template_v2")
    .insert({
      organization_id: session.organizationId,
      scope: "object",
      type_key: draft.typeKey,
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
