"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const orgSchema = z.object({
  name: requiredText("Organizations need a name.", 200),
  category: z.enum([
    "funder", "sponsor", "school", "university", "community",
    "government", "vendor", "media", "donor", "association",
  ]),
  website: z.string().trim().url().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional(),
  nextActionAt: z.string().optional(),
  sensitiveNotes: z.string().trim().max(5000).optional(),
});

export interface DuplicateMatch {
  id: string;
  name: string;
  category: string;
}

/**
 * Duplicate detection (§10.13 acceptance, CRM-005): warns on matching name
 * or email domain before a new record is created, while still allowing a
 * deliberate duplicate.
 */
export async function findDuplicateOrganizations(
  name: string,
  website?: string,
): Promise<DuplicateMatch[]> {
  const session = await requireSession();
  if (!session.isStaff || name.trim().length < 3) return [];

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("crm_organization")
    .select("id, name, category, website")
    .ilike("name", `%${name.trim()}%`)
    .limit(5);

  const matches = (data ?? []) as DuplicateMatch[] & { website?: string }[];

  // Also match on the website's registrable host when one is supplied.
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./, "");
      const { data: byDomain } = await supabase
        .from("crm_organization")
        .select("id, name, category")
        .ilike("website", `%${host}%`)
        .limit(5);
      for (const row of byDomain ?? []) {
        if (!matches.some((m) => m.id === row.id)) {
          matches.push(row as DuplicateMatch);
        }
      }
    } catch {
      // Malformed URL — name matching alone is enough.
    }
  }

  return matches.map((m) => ({ id: m.id, name: m.name, category: m.category }));
}

export async function createCrmOrganization(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = orgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, category, website, notes, nextActionAt, sensitiveNotes } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: org, error } = await supabase
    .from("crm_organization")
    .insert({
      organization_id: session.organizationId,
      name,
      category,
      website: website || null,
      notes: notes || null,
      next_action_at: nextActionAt || null,
      sensitive_notes: sensitiveNotes || null,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !org) return { ok: false, error: "Could not save the organization." };

  revalidatePath("/crm");
  return { ok: true, id: org.id as string };
}

export async function updateCrmOrganization(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = orgSchema.extend({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { id, name, category, website, notes, nextActionAt, sensitiveNotes } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {
    name,
    category,
    website: website || null,
    notes: notes || null,
    next_action_at: nextActionAt || null,
  };
  if (sensitiveNotes !== undefined) patch.sensitive_notes = sensitiveNotes || null;
  const { error } = await supabase.from("crm_organization").update(patch).eq("id", id);
  if (error) return { ok: false, error: "Could not update the organization." };
  revalidatePath("/crm");
  revalidatePath(`/crm/${id}`);
  return { ok: true, id };
}

export async function setCrmOrganizationStatus(
  id: string,
  status: "active" | "inactive",
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_organization").update({ status }).eq("id", id);
  if (error) {
    return {
      ok: false,
      error:
        status === "active"
          ? "An active relationship needs an owner and a next action."
          : "Could not archive the organization.",
    };
  }
  revalidatePath("/crm");
  revalidatePath(`/crm/${id}`);
  return { ok: true, id };
}

const agreementSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  title: requiredText("Agreements need a title.", 200),
  contactId: z.string().uuid().optional(),
  status: z.enum(["draft", "active", "ended"]).default("draft"),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
  notes: z.string().trim().max(5000).optional(),
});

export async function createCrmAgreement(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = agreementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("crm_agreement")
    .insert({
      organization_id: session.organizationId,
      crm_organization_id: data.crmOrganizationId,
      contact_id: data.contactId || null,
      title: data.title,
      status: data.status,
      starts_on: data.startsOn || null,
      ends_on: data.endsOn || null,
      notes: data.notes || null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "Could not save the agreement." };
  revalidatePath(`/crm/${data.crmOrganizationId}`);
  return { ok: true, id: row.id as string };
}

const contactSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  fullName: requiredText("Contacts need a name.", 200),
  roleTitle: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(300).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  communicationNotes: z.string().trim().max(5000).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function createCrmContact(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_contact").insert({
    organization_id: session.organizationId,
    crm_organization_id: data.crmOrganizationId,
    full_name: data.fullName,
    role_title: data.roleTitle || null,
    email: data.email || null,
    phone: data.phone || null,
    communication_notes: data.communicationNotes || null,
    status: data.status ?? "active",
    owner_id: session.userId,
  });
  if (error) return { ok: false, error: "Could not save the contact." };

  revalidatePath(`/crm/${data.crmOrganizationId}`);
  return { ok: true };
}

const interactionSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  interactionType: z.enum(["meeting", "call", "email", "message", "note", "other"]),
  summary: requiredText("Describe the interaction.", 5000),
  nextSteps: z.string().trim().max(2000).optional(),
  documentId: z.string().uuid().optional(),
});

export async function recordInteraction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = interactionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_interaction").insert({
    organization_id: session.organizationId,
    crm_organization_id: data.crmOrganizationId,
    contact_id: data.contactId ?? null,
    interaction_type: data.interactionType,
    owner_id: session.userId,
    summary: data.summary,
    next_steps: data.nextSteps || null,
    document_id: data.documentId || null,
  });
  if (error) return { ok: false, error: "Could not record the interaction." };

  revalidatePath(`/crm/${data.crmOrganizationId}`);
  return { ok: true };
}

const followUpSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  title: requiredText("Follow-ups need a description.", 300),
  dueAt: requiredText("Pick a due date."),
});

export async function createFollowUp(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_follow_up").insert({
    organization_id: session.organizationId,
    crm_organization_id: data.crmOrganizationId,
    owner_id: session.userId,
    title: data.title,
    due_at: data.dueAt,
  });
  if (error) return { ok: false, error: "Could not create the follow-up." };

  revalidatePath(`/crm/${data.crmOrganizationId}`);
  revalidatePath("/crm");
  return { ok: true };
}

export async function completeFollowUp(followUpId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("crm_follow_up")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", followUpId);
  if (error) return { ok: false, error: "Could not complete the follow-up." };
  revalidatePath("/crm");
  return { ok: true };
}

const crmLinkSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  agreementId: z.string().uuid().optional(),
});

export async function createCrmLink(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = crmLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  if (
    !data.programId &&
    !data.projectId &&
    !data.eventId &&
    !data.taskId &&
    !data.opportunityId &&
    !data.agreementId
  ) {
    return { ok: false, error: "Choose a program, project, event, grant, agreement or task to link." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("crm_link").insert({
    organization_id: session.organizationId,
    crm_organization_id: data.crmOrganizationId,
    contact_id: data.contactId || null,
    program_id: data.programId || null,
    project_id: data.projectId || null,
    event_id: data.eventId || null,
    task_id: data.taskId || null,
    opportunity_id: data.opportunityId || null,
    agreement_id: data.agreementId || null,
  });
  if (error) return { ok: false, error: "Could not link that record." };
  revalidatePath(`/crm/${data.crmOrganizationId}`);
  return { ok: true };
}

export async function convertFollowUpToTask(followUpId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();
  const { data: followUp } = await supabase
    .from("crm_follow_up")
    .select("id, title, due_at, owner_id, task_id, crm_organization_id")
    .eq("id", followUpId)
    .maybeSingle();
  if (!followUp) return { ok: false, error: "That follow-up no longer exists." };
  if (followUp.task_id) return { ok: true, id: followUp.task_id as string };

  const { createTask } = await import("@/features/tasks/services/task.commands");
  const created = await createTask({
    title: followUp.title,
    dueAt: followUp.due_at,
    assigneeId: followUp.owner_id,
  });
  if (!created.ok || !created.id) return created;

  const { error } = await supabase
    .from("crm_follow_up")
    .update({ task_id: created.id })
    .eq("id", followUpId)
    .is("task_id", null);
  if (error) {
    return { ok: false, error: "The task was created, but the follow-up could not be linked." };
  }

  revalidatePath("/crm");
  revalidatePath(`/crm/${followUp.crm_organization_id}`);
  return { ok: true, id: created.id };
}
