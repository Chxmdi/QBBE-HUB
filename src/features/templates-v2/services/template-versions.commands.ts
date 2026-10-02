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
import { buildHub, findPageVariables, type PageBody, type PageDocument } from "@/features/templates-v2/template";

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
  const [{ data: versions, error: versionsError }, { data: pages, error: pagesError }] = await Promise.all([
    supabase
      .from("template_v2_version")
      .select("version, created_at")
      .eq("template_id", id.data)
      .order("version", { ascending: false })
      .limit(200),
    // Counted in the database, as the reader: pages they cannot open are not counted.
    supabase.rpc("template_v2_version_pages", { p_template: id.data }),
  ]);
  if (versionsError || pagesError) return { ok: false, error: m.errors.generic };
  const counts = new Map<number, number>();
  for (const row of (pages ?? []) as { version: number; pages: number }[]) counts.set(row.version, Number(row.pages));
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
const start = z.number().int().min(0).max(3650).optional();
const draftRow = z.object({ en: z.string().max(200), fr: z.string().max(200), due: z.string().max(20), start });
const updateSchema = z.object({
  id: uuid,
  /** The version the editor was opened on: a save over a newer one is refused, not merged. */
  version: z.number().int().min(1),
  name: bilingual(200),
  description: bilingual(2000),
  title: bilingual(200),
  document: z.object({ en: blocks, fr: blocks }),
  milestones: z.array(draftRow).max(50),
  tasks: z
    .array(
      draftRow.extend({
        milestone: z.string().max(3),
        priority: z.enum(["low", "medium", "high", "critical"]).optional(),
        description: bilingual(5000).optional(),
      }),
    )
    .max(200),
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
  // The database counts the bytes of its own JSON text, which has more spaces; leave room for them.
  if (new TextEncoder().encode(JSON.stringify(document)).length > MAX_DOCUMENT_BYTES * 0.9) {
    return { ok: false, error: m.errors.tooLarge };
  }
  const hub = buildHub(draft.milestones, draft.tasks);
  if (!hub.ok) return { ok: false, error: m.errors[hub.problem] };
  const variables = findPageVariables(JSON.stringify([title, document]));
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
    .eq("version", draft.version)
    .select("version")
    .maybeSingle();
  if (error) {
    if (error.code === "23514") return { ok: false, error: /1 MB/.test(error.message) ? m.errors.tooLarge : m.errors.document };
    return { ok: false, error: m.errors.generic };
  }
  if (!data) {
    // Someone saved a newer version since the editor opened, or the reader may not edit it.
    const { data: current } = await supabase.from("template_v2").select("version").eq("id", draft.id).maybeSingle();
    return { ok: false, error: current && current.version !== draft.version ? m.errors.conflict : m.errors.forbidden };
  }
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
