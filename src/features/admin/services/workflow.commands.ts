"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const saveViewSchema = z.object({
  name: z.string().trim().min(1, "Name the view.").max(80),
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

export async function deleteSavedView(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("saved_view")
    .delete()
    .eq("id", id)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: "Could not delete the view." };
  revalidatePath("/my-work");
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
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
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
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("workflow_rule")
    .update({ enabled })
    .eq("id", id);
  if (error) return { ok: false, error: "Could not update the rule." };
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

export async function createProjectFromTemplate(templateId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from("project_template")
    .select("name, outcome, default_stage")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };
  const { createProject } = await import("@/features/projects/services/project.commands");
  return createProject({
    name: template.name,
    outcome: template.outcome ?? undefined,
    stage: template.default_stage,
  });
}
