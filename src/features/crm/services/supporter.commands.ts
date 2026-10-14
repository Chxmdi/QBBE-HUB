"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * Staff actions on supporters (individual CRM contacts, from Zeffy or entered
 * in the Hub). Row-level security decides what each person may change; these
 * only shape the input and say what went wrong in the person's language.
 */

const linkSchema = z.object({
  contactId: z.string().uuid(),
  crmOrganizationId: z.string().uuid().nullable(),
});

/** Links a supporter to a CRM organization (their employer, school, ...), or unlinks. */
export async function linkSupporterOrganization(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("crm.errors.staffRequired") };
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("crm.supporter.saveFailed") };
  const { contactId, crmOrganizationId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  if (crmOrganizationId) {
    const { data: organization } = await supabase
      .from("crm_organization")
      .select("id")
      .eq("id", crmOrganizationId)
      .eq("organization_id", session.organizationId)
      .maybeSingle();
    if (!organization) return { ok: false, error: t("crm.supporter.saveFailed") };
  }
  const { data, error } = await supabase
    .from("crm_contact")
    .update({ crm_organization_id: crmOrganizationId })
    .eq("id", contactId)
    .eq("organization_id", session.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: t("crm.supporter.saveFailed") };

  revalidatePath(`/crm/contacts/${contactId}`);
  if (crmOrganizationId) revalidatePath(`/crm/${crmOrganizationId}`);
  return { ok: true };
}

const interactionSchema = z.object({
  contactId: z.string().uuid(),
  interactionType: z.enum(["meeting", "call", "email", "message", "note", "other"]),
  summary: z.string().trim().min(1).max(2000),
});

/** Records a call, meeting, note, ... with a supporter who may belong to no organization. */
export async function recordSupporterInteraction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("crm.errors.staffRequired") };
  const parsed = interactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("crm.validation.describeInteraction") };
  const { contactId, interactionType, summary } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: contact } = await supabase
    .from("crm_contact")
    .select("id, crm_organization_id")
    .eq("id", contactId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!contact) return { ok: false, error: t("crm.errors.recordInteraction") };

  const { error } = await supabase.from("crm_interaction").insert({
    organization_id: session.organizationId,
    crm_organization_id: (contact as { crm_organization_id: string | null }).crm_organization_id,
    contact_id: contactId,
    interaction_type: interactionType,
    owner_id: session.userId,
    summary,
  });
  if (error) return { ok: false, error: t("crm.errors.recordInteraction") };

  revalidatePath(`/crm/contacts/${contactId}`);
  return { ok: true };
}

const matchSchema = z.object({
  matchId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
});

/**
 * Places a Zeffy supporter the sync could not: on one of the suggested
 * contacts, or as a new contact. The database checks the choice and audits it.
 */
export async function resolveZeffyMatch(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("crm.errors.staffRequired") };
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("crm.zeffy.matchFailed") };
  const limited = await enforceRateLimit("zeffy:match", session.userId);
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("zeffy_resolve_match", {
    p_match: parsed.data.matchId,
    p_contact: parsed.data.contactId,
  });
  if (error || !data) return { ok: false, error: t("crm.zeffy.matchFailed") };

  revalidatePath("/crm/zeffy");
  revalidatePath("/crm/supporters");
  revalidatePath(`/crm/contacts/${data as string}`);
  return { ok: true, id: data as string };
}
