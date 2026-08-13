"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const orgSchema = z.object({
  name: z.string().trim().min(1, "Organizations need a name.").max(200),
  category: z.enum([
    "funder", "sponsor", "school", "university", "community",
    "government", "vendor", "media", "donor", "association",
  ]),
  website: z.string().trim().url().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional(),
});

export async function createCrmOrganization(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = orgSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, category, website, notes } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: org, error } = await supabase
    .from("crm_organization")
    .insert({
      organization_id: session.organizationId,
      name,
      category,
      website: website || null,
      notes: notes || null,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !org) return { ok: false, error: "Could not save the organization." };

  revalidatePath("/crm");
  return { ok: true, id: org.id as string };
}

const contactSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  fullName: z.string().trim().min(1, "Contacts need a name.").max(200),
  roleTitle: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(300).optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
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
  summary: z.string().trim().min(1, "Describe the interaction.").max(5000),
  nextSteps: z.string().trim().max(2000).optional(),
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
  });
  if (error) return { ok: false, error: "Could not record the interaction." };

  revalidatePath(`/crm/${data.crmOrganizationId}`);
  return { ok: true };
}

const followUpSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  title: z.string().trim().min(1, "Follow-ups need a description.").max(300),
  dueAt: z.string().min(1, "Pick a due date."),
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
