"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  SETTLED_STAGES,
  createOpportunitySchema,
  updateOpportunitySchema,
} from "@/features/crm/opportunity-schemas";

/**
 * Writes to the funding pipeline.
 *
 * No role check here: `opportunity_staff` is the boundary, and a second
 * expression of the same rule in TypeScript is one more place for the two to
 * drift apart. A volunteer's insert fails at the database and comes back as a
 * permission message.
 */

/** Tells a newly assigned owner once, and never tells you about your own work. */
async function notifyOwner(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: {
    ownerId: string | null | undefined;
    actorId: string;
    organizationId: string;
    opportunityId: string;
    crmOrganizationId: string;
    title: string;
  },
) {
  if (!input.ownerId || input.ownerId === input.actorId) return;
  await supabase.from("notification").upsert(
    {
      user_id: input.ownerId,
      organization_id: input.organizationId,
      category: "assignment",
      title: `You own an opportunity: ${input.title}`,
      source_type: "opportunity",
      source_id: input.opportunityId,
      link: `/crm/${input.crmOrganizationId}?tab=opportunities&opportunity=${input.opportunityId}`,
      urgency: "normal",
      dedupe_key: `opportunity-owner:${input.opportunityId}:${input.ownerId}`,
    },
    { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
  );
}

export async function createOpportunity(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createOpportunitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("opportunity")
    .insert({
      organization_id: session.organizationId,
      crm_organization_id: data.crmOrganizationId,
      contact_id: data.contactId || null,
      title: data.title,
      description: data.description || null,
      kind: data.kind,
      stage: data.stage,
      currency: data.currency,
      amount_requested: data.amountRequested ?? null,
      amount_awarded: data.amountAwarded ?? null,
      program_id: data.programId || null,
      project_id: data.projectId || null,
      owner_id: data.ownerId,
      submitted_at: data.submittedAt || null,
      decision_expected_at: data.decisionExpectedAt || null,
      decided_at: data.decidedAt || null,
      outcome_note: data.outcomeNote || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return {
      ok: false,
      error: "You don't have permission to record opportunities, or the save failed.",
    };
  }

  await notifyOwner(supabase, {
    ownerId: data.ownerId,
    actorId: session.userId,
    organizationId: session.organizationId,
    opportunityId: created.id as string,
    crmOrganizationId: data.crmOrganizationId,
    title: data.title,
  });

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "opportunity",
    source_id: created.id,
    summary: `opened opportunity “${data.title}”`,
  });

  revalidatePath(`/crm/${data.crmOrganizationId}`);
  revalidatePath("/crm");
  return { ok: true, id: created.id as string };
}

export async function updateOpportunity(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateOpportunitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { opportunityId, ...fields } = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Needed for the revalidate path and for the owner notification; also the
  // cheapest way to find out the row is not readable by this person.
  const { data: existing } = await supabase
    .from("opportunity")
    .select("id, crm_organization_id, title, stage, owner_id")
    .eq("id", opportunityId)
    .maybeSingle();

  if (!existing) {
    return { ok: false, error: "That opportunity is not available to you." };
  }

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description || null;
  if (fields.kind !== undefined) patch.kind = fields.kind;
  if (fields.currency !== undefined) patch.currency = fields.currency;
  if (fields.amountRequested !== undefined) {
    patch.amount_requested = fields.amountRequested ?? null;
  }
  if (fields.contactId !== undefined) patch.contact_id = fields.contactId || null;
  if (fields.programId !== undefined) patch.program_id = fields.programId || null;
  if (fields.projectId !== undefined) patch.project_id = fields.projectId || null;
  if (fields.ownerId !== undefined) patch.owner_id = fields.ownerId;
  if (fields.submittedAt !== undefined) patch.submitted_at = fields.submittedAt || null;
  if (fields.decisionExpectedAt !== undefined) {
    patch.decision_expected_at = fields.decisionExpectedAt || null;
  }
  if (fields.outcomeNote !== undefined) patch.outcome_note = fields.outcomeNote || null;

  if (fields.stage !== undefined) {
    patch.stage = fields.stage;
    const settling = SETTLED_STAGES.includes(fields.stage);
    // A settled bid gets the decision date it was given, or today. Reopening
    // one clears the decision and the award, because the database will not
    // hold either on an open row — and a stale figure in a total is worse
    // than a missing one.
    patch.decided_at = settling
      ? fields.decidedAt || new Date().toISOString().slice(0, 10)
      : null;
    if (!settling) patch.amount_awarded = null;
  }
  if (fields.amountAwarded !== undefined && patch.amount_awarded === undefined) {
    patch.amount_awarded = fields.amountAwarded ?? null;
  }
  if (fields.decidedAt !== undefined && patch.decided_at === undefined) {
    patch.decided_at = fields.decidedAt || null;
  }

  const { error } = await supabase
    .from("opportunity")
    .update(patch)
    .eq("id", opportunityId);

  if (error) {
    return {
      ok: false,
      error: "That change was refused — check the stage, amount and dates agree.",
    };
  }

  if (fields.ownerId && fields.ownerId !== existing.owner_id) {
    await notifyOwner(supabase, {
      ownerId: fields.ownerId,
      actorId: session.userId,
      organizationId: session.organizationId,
      opportunityId,
      crmOrganizationId: existing.crm_organization_id as string,
      title: (fields.title ?? existing.title) as string,
    });
  }

  if (fields.stage && fields.stage !== existing.stage) {
    await supabase.from("activity_event").insert({
      organization_id: session.organizationId,
      actor_id: session.userId,
      verb: "updated",
      source_type: "opportunity",
      source_id: opportunityId,
      summary: `moved “${existing.title}” to ${fields.stage}`,
    });
  }

  revalidatePath(`/crm/${existing.crm_organization_id}`);
  revalidatePath("/crm");
  return { ok: true, id: opportunityId };
}
