"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredText } from "@/lib/schema";
import { calendarDateInZone } from "@/lib/time";
import { expandProjectTemplate } from "@/features/projects/services/template-expansion";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createSchema = z.object({
  name: requiredText("A template needs a name.", 200),
  description: z.string().trim().max(2000).optional(),
  color: z.enum(["neutral", "blue", "green", "amber", "rose"]).default("neutral"),
});

export async function createProgramTemplate(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("program_template")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      color: parsed.data.color,
      created_by: session.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the template." };
  revalidatePath("/programs");
  return { ok: true, id: data.id as string };
}

/**
 * Approval is what makes a template "QBBE-approved" and therefore usable.
 * Recorded as who and when, because an approval nobody is named on is not one.
 */
export async function setProgramTemplateApproval(
  templateId: string,
  approved: boolean,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Invalid template." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("program_template")
    .update(
      approved
        ? { approved_at: new Date().toISOString(), approved_by: session.userId }
        : { approved_at: null, approved_by: null },
    )
    .eq("id", templateId)
    .eq("organization_id", session.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not update the template." };
  revalidatePath("/programs");
  return { ok: true, id: templateId };
}

/**
 * Expand an approved template into a real program: the program itself, a
 * project per named project template, and each project's milestones and
 * standard tasks.
 *
 * Nothing historical is copied, because there is nothing historical to copy —
 * a template holds structure, never records. That is what keeps P1-PROG-03's
 * "without duplicating data manually" from becoming "with somebody else's
 * comments attached".
 */
export async function createProgramFromTemplate(
  templateId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Invalid template." };
  }

  const db = await createSupabaseServerClient();
  const { data: template } = await db
    .from("program_template")
    .select("id, name, description, color, approved_at")
    .eq("id", templateId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };
  if (!template.approved_at) {
    return {
      ok: false,
      error: "This template has not been approved yet, so it cannot be used.",
    };
  }

  const { createProgram, createProject } = await import(
    "@/features/projects/services/project.commands"
  );
  // createProgram also provisions the program channel, so instantiation and
  // ordinary creation produce the same shape of program rather than two.
  const created = await createProgram({
    name: template.name,
    description: template.description ?? undefined,
  });
  if (!created.ok || !created.id) {
    return { ok: false, error: created.error ?? "Could not create the program." };
  }
  const programId = created.id;

  // The colour is part of the approved structure; createProgram does not take it.
  await db.from("program").update({ color: template.color }).eq("id", programId);

  const { data: rows } = await db
    .from("program_template_project")
    .select(
      "sort_key, project_template:project_template_id(id, name, outcome, default_stage)",
    )
    .eq("program_template_id", templateId)
    .order("sort_key");

  const startDate =
    calendarDateInZone(new Date(), session.timeZone) ??
    new Date().toISOString().slice(0, 10);

  for (const row of (rows ?? []) as unknown as {
    project_template: {
      id: string;
      name: string;
      outcome: string | null;
      default_stage: string;
    } | null;
  }[]) {
    const projectTemplate = row.project_template;
    if (!projectTemplate) continue;

    const project = await createProject({
      name: projectTemplate.name,
      outcome: projectTemplate.outcome ?? undefined,
      programId,
      // A template cannot know a target date, and `active` requires one, so an
      // instantiated project starts at planning rather than failing its trigger.
      stage:
        projectTemplate.default_stage === "active"
          ? "planning"
          : projectTemplate.default_stage,
    });
    if (!project.ok || !project.id) continue;

    await expandProjectTemplate({
      projectTemplateId: projectTemplate.id,
      projectId: project.id,
      startDate,
    });
  }

  revalidatePath("/programs");
  revalidatePath("/projects");
  return { ok: true, id: programId };
}

/** Templates a member may choose from. Unapproved ones are not offered. */
export async function listApprovedProgramTemplates() {
  await requireSession();
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("program_template")
    .select("id, name, description")
    .not("approved_at", "is", null)
    .order("name");
  return (data ?? []) as { id: string; name: string; description: string | null }[];
}

/** Put a project template into a program template's structure. */
export async function addProjectTemplateToProgram(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = z
    .object({
      programTemplateId: z.string().uuid(),
      projectTemplateId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a project template." };

  const db = await createSupabaseServerClient();
  const { error } = await db.from("program_template_project").insert({
    program_template_id: parsed.data.programTemplateId,
    project_template_id: parsed.data.projectTemplateId,
  });
  if (error) {
    // The unique constraint means it is already in the structure, which is the
    // state the caller wanted; the cross-organization trigger is a real refusal.
    if (error.code === "23505") return { ok: true };
    if (error.code === "23514") {
      return { ok: false, error: "That project template belongs to another organization." };
    }
    return { ok: false, error: "Could not add the project template." };
  }
  revalidatePath("/programs");
  return { ok: true };
}

export async function removeProjectTemplateFromProgram(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = z
    .object({
      programTemplateId: z.string().uuid(),
      projectTemplateId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid selection." };
  const db = await createSupabaseServerClient();
  const { error } = await db
    .from("program_template_project")
    .delete()
    .eq("program_template_id", parsed.data.programTemplateId)
    .eq("project_template_id", parsed.data.projectTemplateId);
  if (error) return { ok: false, error: "Could not remove the project template." };
  revalidatePath("/programs");
  return { ok: true };
}

/** Every template, approved or not, for the administrator who maintains them. */
export async function listProgramTemplatesForAdmin() {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("program_template")
    .select(
      "id, name, description, approved_at, projects:program_template_project(project_template_id, project_template:project_template_id(id, name))",
    )
    .order("name");
  return (data ?? []) as unknown as {
    id: string;
    name: string;
    description: string | null;
    approved_at: string | null;
    projects: { project_template: { id: string; name: string } | null }[];
  }[];
}
