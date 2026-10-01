"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fill, formsV2Text } from "@/features/forms-v2/messages";
import {
  FORM_PROPERTY_KINDS,
  MAX_PROPERTIES,
  SHOW_IF_OPS,
  TYPE_KEY_PATTERN,
  localized,
  parseFormAnswers,
  propertiesProblem,
  type FormV2Property,
} from "@/features/forms-v2/properties";

export type FormsV2Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const text = z.object({ en: z.string().trim().max(200), fr: z.string().trim().max(200) });

const showIfSchema = z.object({
  key: z.string(),
  op: z.enum(SHOW_IF_OPS),
  value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});

const propertySchema = z.object({
  key: z.string(),
  kind: z.enum(FORM_PROPERTY_KINDS),
  label: text,
  required: z.boolean(),
  options: z.array(z.object({ key: z.string(), label: text })).max(50).optional(),
  showIf: showIfSchema.optional(),
});

const formSchema = z.object({
  typeKey: z.string().trim(),
  targetProjectId: z.string().uuid().nullable(),
  title: text,
  description: z.object({ en: z.string().trim().max(2000), fr: z.string().trim().max(2000) }),
  audience: z.enum(["members", "staff"]),
  properties: z.array(propertySchema).max(MAX_PROPERTIES),
});

export type FormV2Input = z.infer<typeof formSchema>;

async function messages() {
  return formsV2Text(await getLocale());
}

/** Every action refuses while the module's switch is off. */
async function guard(): Promise<string | null> {
  if (await isEnabled("wos_forms_v2")) return null;
  return (await messages()).errors.forbidden;
}

export async function createFormV2(input: FormV2Input): Promise<FormsV2Result<{ id: string }>> {
  const blocked = await guard();
  if (blocked) return { ok: false, error: blocked };
  const m = await messages();
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.generic };
  const form = parsed.data;
  if (!form.title.en || !form.title.fr) return { ok: false, error: m.errors.title };
  if (!TYPE_KEY_PATTERN.test(form.typeKey)) return { ok: false, error: m.errors.typeKey };
  if (form.properties.length === 0) return { ok: false, error: m.errors.noQuestions };
  const properties: FormV2Property[] = form.properties.map((p) => ({
    ...p,
    ...(p.kind === "select" ? { options: p.options ?? [] } : { options: undefined }),
    ...(p.showIf ? { showIf: p.showIf } : { showIf: undefined }),
  }));
  const problem = propertiesProblem(form.typeKey, properties);
  if (problem) return { ok: false, error: m.errors[problem] };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("form_v2")
    .insert({
      organization_id: auth.session.organizationId,
      type_key: form.typeKey,
      target_project_id: form.typeKey === "task" ? form.targetProjectId : null,
      title_en: form.title.en,
      title_fr: form.title.fr,
      description_en: form.description.en || null,
      description_fr: form.description.fr || null,
      audience: form.audience,
      properties: JSON.parse(JSON.stringify(properties)),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: m.errors.generic };
  revalidatePath("/forms-v2");
  return { ok: true, data: { id: data.id as string } };
}

export async function setFormV2Status(
  formId: string,
  status: "published" | "closed",
): Promise<FormsV2Result> {
  const blocked = await guard();
  if (blocked) return { ok: false, error: blocked };
  const m = await messages();
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(formId).success) return { ok: false, error: m.errors.generic };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("form_v2").update({ status }).eq("id", formId).select("id");
  if (error || !data?.length) return { ok: false, error: m.errors.generic };
  revalidatePath("/forms-v2");
  revalidatePath(`/forms-v2/${formId}`);
  return { ok: true };
}

export async function deleteDraftFormV2(formId: string): Promise<FormsV2Result> {
  const blocked = await guard();
  if (blocked) return { ok: false, error: blocked };
  const m = await messages();
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(formId).success) return { ok: false, error: m.errors.generic };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("form_v2").delete().eq("id", formId).select("id");
  if (error || !data?.length) return { ok: false, error: m.errors.generic };
  revalidatePath("/forms-v2");
  return { ok: true };
}

export async function submitFormV2(
  formId: string,
  raw: Record<string, string | boolean>,
): Promise<FormsV2Result<{ objectType: string; objectId: string }>> {
  const blocked = await guard();
  if (blocked) return { ok: false, error: blocked };
  const locale = await getLocale();
  const m = formsV2Text(locale);
  const session = await requireSession();
  if (!z.string().uuid().safeParse(formId).success) return { ok: false, error: m.errors.notOpen };
  const limited = await enforceRateLimit("form:submit", session.userId);
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  const { data: form } = await supabase
    .from("form_v2")
    .select("id, properties, status")
    .eq("id", formId)
    .maybeSingle();
  if (!form || form.status !== "published") return { ok: false, error: m.errors.notOpen };

  const properties = form.properties as FormV2Property[];
  const parsed = parseFormAnswers(properties, raw);
  if (!parsed.ok) {
    return {
      ok: false,
      error: fill(m.errors[parsed.problem], { label: localized(parsed.property.label, locale) }),
    };
  }
  const { data, error } = await supabase.rpc("submit_form_v2", {
    p_form_id: formId,
    p_answers: parsed.answers,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    if (error?.code === "42501" && /not one you uploaded/.test(error.message)) {
      const file = properties.find((p) => p.kind === "file" && parsed.answers[p.key] !== undefined);
      return { ok: false, error: fill(m.errors.fileNotYours, { label: file ? localized(file.label, locale) : "" }) };
    }
    return { ok: false, error: error?.code === "42501" ? m.errors.notOpen : m.errors.generic };
  }
  revalidatePath(`/forms-v2/${formId}`);
  return { ok: true, data: { objectType: row.object_type as string, objectId: row.object_id as string } };
}

/** Copies (or un-copies) the forms made with the original builder. */
export async function convertLegacyForms(direction: "convert" | "revert"): Promise<FormsV2Result<{ count: number }>> {
  const blocked = await guard();
  if (blocked) return { ok: false, error: blocked };
  const m = await messages();
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    direction === "convert" ? "forms_v2_convert_legacy" : "forms_v2_revert_legacy",
    { p_organization_id: auth.session.organizationId },
  );
  if (error) return { ok: false, error: m.errors.generic };
  revalidatePath("/forms-v2");
  return { ok: true, data: { count: Number(data ?? 0) } };
}
