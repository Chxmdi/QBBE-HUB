"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone } from "@/lib/time";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const saveViewSchema = z.object({
  name: requiredText("Name the view.", 80),
  path: z.string().trim().min(1).max(120).default("/my-work"),
  query: z.record(z.string()).default({}),
});

export async function saveView(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = saveViewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid view." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("saved_view")
    .insert({
      organization_id: session.organizationId,
      user_id: session.userId,
      name: parsed.data.name,
      path: parsed.data.path,
      query: parsed.data.query,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the view." };
  revalidatePath(parsed.data.path);
  return { ok: true, id: data.id as string };
}

export async function deleteSavedView(id: string, path = "/my-work"): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("saved_view")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: "Could not delete the view." };
  revalidatePath(path);
  return { ok: true };
}

const workflowSchema = z.object({
  name: z.string().trim().min(1).max(120),
  triggerEvent: z.enum([
    "task_status_changed",
    "announcement_published",
    "project_health_changed",
    "meeting_completed",
    "event_assignment_created",
  ]),
  conditionStatus: z.string().optional(),
  actionCategory: z.enum(["notify_assignee", "notify_admins", "notify_event_owner", "notify_team"]).default("notify_assignee"),
  actionTeamId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.actionCategory === "notify_team" && !value.actionTeamId) {
    context.addIssue({ code: "custom", path: ["actionTeamId"], message: "Select the team to notify." });
  }
});

export async function createWorkflowRule(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid rule." };
  const supabase = await createSupabaseServerClient();
  if (parsed.data.actionCategory === "notify_team") {
    const { data: team } = await supabase
      .from("team")
      .select("id")
      .eq("id", parsed.data.actionTeamId!)
      .maybeSingle();
    if (!team) return { ok: false, error: "Team not found." };
  }
  const { data, error } = await supabase
    .from("workflow_rule")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      trigger_event: parsed.data.triggerEvent,
      condition: parsed.data.conditionStatus
        ? { status: parsed.data.conditionStatus }
        : {},
      action: {
        type: parsed.data.actionCategory,
        ...(parsed.data.actionTeamId ? { teamId: parsed.data.actionTeamId } : {}),
      },
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not create the rule." };
  revalidatePath("/admin");
  return { ok: true, id: data.id as string };
}

export async function setWorkflowRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("workflow_rule")
    .update({ enabled })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: "Could not update the rule." };
  revalidatePath("/admin");
  return { ok: true };
}

const templateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  outcome: z.string().trim().max(2000).optional(),
  defaultStage: z.enum(["proposed", "approved", "planning", "active"]).default("planning"),
});

export async function createProjectTemplate(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_template")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      outcome: parsed.data.outcome || null,
      default_stage: parsed.data.defaultStage,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the template." };
  revalidatePath("/projects");
  return { ok: true, id: data.id as string };
}

const templateItemSchema = z.object({
  projectTemplateId: z.string().uuid(),
  kind: z.enum(["milestone", "task"]),
  name: requiredText("Name the milestone or task.", 200),
  description: z.string().trim().max(2000).optional(),
  /**
   * Days from the day the template is used. Null means "no date" — a standard
   * task with no deadline is a real thing, and inventing one would put a
   * arbitrary due date on every project built from the template.
   */
  dayOffset: z.coerce.number().int().min(0).max(3650).nullable().default(null),
  sortKey: z.coerce.number().default(0),
});

/** Give a project template the structure it is supposed to reproduce. */
export async function addProjectTemplateItem(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = templateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid item." };
  }
  const { projectTemplateId, kind, name, description, dayOffset, sortKey } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_template_item")
    .insert({
      project_template_id: projectTemplateId,
      kind,
      name,
      description: description || null,
      day_offset: dayOffset,
      sort_key: sortKey,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Could not add that to the template." };
  revalidatePath("/projects");
  return { ok: true, id: data.id as string };
}

export async function removeProjectTemplateItem(itemId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: "Invalid item." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("project_template_item")
    .delete()
    .eq("id", itemId)
    .select("id");
  if (error || (data ?? []).length === 0) {
    return { ok: false, error: "That item could not be removed." };
  }
  revalidatePath("/projects");
  return { ok: true, id: itemId };
}

/** Project templates with the structure they carry, for the maintenance list. */
export async function listProjectTemplates() {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("project_template")
    .select(
      "id, name, outcome, default_stage, " +
        "items:project_template_item(id, kind, name, day_offset, sort_key)",
    )
    .order("name");
  return (data ?? []) as unknown as {
    id: string;
    name: string;
    outcome: string | null;
    default_stage: string;
    items: {
      id: string;
      kind: "milestone" | "task";
      name: string;
      day_offset: number | null;
      sort_key: number;
    }[];
  }[];
}

/**
 * Create a project from a template (P1-PRJ-09).
 *
 * The project arrives with the template's milestones and standard tasks, dated
 * from today in the organization's zone. It arrives with nothing else: no
 * comments, no private notes, no activity from whatever project the template
 * was distilled from — because a template stores none of those. That is a
 * property of the model rather than of a filter here, which is why it cannot
 * quietly regress.
 *
 * `createProject` is the authorization boundary: it requires `manage` on the
 * destination program, or administrator rights when there is no program.
 */
export async function createProjectFromTemplate(
  templateId: string,
  options?: { programId?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Template not found." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from("project_template")
    .select("id, name, outcome, default_stage")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };

  const { createProject } = await import("@/features/projects/services/project.commands");
  const created = await createProject({
    name: template.name,
    outcome: template.outcome ?? undefined,
    programId: options?.programId,
    // A template cannot know a target date, and an active project needs one,
    // so an instantiated project starts at planning rather than failing.
    stage: template.default_stage === "active" ? "planning" : template.default_stage,
  });
  if (!created.ok || !created.id) return created;

  const { expandProjectTemplate } = await import(
    "@/features/projects/services/template-expansion"
  );
  const startDate =
    calendarDateInZone(new Date(), session.timeZone) ??
    new Date().toISOString().slice(0, 10);

  await expandProjectTemplate({
    projectTemplateId: template.id as string,
    projectId: created.id,
    startDate,
  });

  revalidatePath("/projects");
  return created;
}
