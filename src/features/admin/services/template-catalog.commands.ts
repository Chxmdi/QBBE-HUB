"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredText } from "@/lib/schema";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const KINDS = ["task", "event", "update", "report"] as const;

function revalidateCatalog() {
  revalidatePath("/admin/templates");
  revalidatePath("/projects");
  revalidatePath("/meetings");
}

async function requireStaff() {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false as const, error: "Staff access required.", session };
  return { ok: true as const, session };
}

export async function setProjectTemplateApproval(
  templateId: string,
  approved: boolean,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Invalid template." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("project_template")
    .update(
      approved
        ? {
            approved_at: new Date().toISOString(),
            approved_by: authorization.session.userId,
          }
        : { approved_at: null, approved_by: null },
    )
    .eq("id", templateId)
    .eq("organization_id", authorization.session.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not update the template." };
  revalidateCatalog();
  return { ok: true, id: templateId };
}

const agendaSchema = z.object({
  name: requiredText("Name the agenda.", 200),
  items: z.string().trim().max(8000),
});

/** One title per line. Structure only — no owners, history, or private notes. */
export async function createAgendaTemplate(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!staff.ok) return { ok: false, error: staff.error };
  const parsed = agendaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid agenda." };
  }
  const items = parsed.data.items
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((title) => ({ title }));
  if (items.length === 0) return { ok: false, error: "Add at least one agenda item." };

  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("agenda_template")
    .insert({
      organization_id: staff.session.organizationId,
      name: parsed.data.name,
      kind: "meeting",
      items,
      created_by: staff.session.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the agenda template." };
  revalidateCatalog();
  return { ok: true, id: data.id as string };
}

export async function setAgendaTemplateApproval(
  templateId: string,
  approved: boolean,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Invalid template." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("agenda_template")
    .update(
      approved
        ? {
            approved_at: new Date().toISOString(),
            approved_by: authorization.session.userId,
          }
        : { approved_at: null, approved_by: null },
    )
    .eq("id", templateId)
    .eq("organization_id", authorization.session.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not update the agenda template." };
  revalidateCatalog();
  return { ok: true, id: templateId };
}

const recordSchema = z.object({
  kind: z.enum(KINDS),
  name: requiredText("Name the template.", 200),
  title: requiredText("The record needs a title.", 200),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  eventType: z.string().trim().max(80).optional(),
  progressSummary: z.string().trim().max(4000).optional(),
  reportType: z.string().trim().max(80).optional(),
});

export async function createRecordTemplate(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!staff.ok) return { ok: false, error: staff.error };
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  }
  const { kind, name, title, description, priority, eventType, progressSummary, reportType } =
    parsed.data;
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_template")
    .insert({
      organization_id: staff.session.organizationId,
      kind,
      name,
      structure: {
        title,
        description: description || null,
        priority: priority || null,
        eventType: eventType || null,
        progressSummary: progressSummary || null,
        reportType: reportType || null,
      },
      created_by: staff.session.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the template." };
  revalidateCatalog();
  return { ok: true, id: data.id as string };
}

export async function setRecordTemplateApproval(
  templateId: string,
  approved: boolean,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  if (!z.string().uuid().safeParse(templateId).success) {
    return { ok: false, error: "Invalid template." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_template")
    .update(
      approved
        ? {
            approved_at: new Date().toISOString(),
            approved_by: authorization.session.userId,
          }
        : { approved_at: null, approved_by: null },
    )
    .eq("id", templateId)
    .eq("organization_id", authorization.session.organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not update the template." };
  revalidateCatalog();
  return { ok: true, id: templateId };
}

const instantiateSchema = z.object({
  templateId: z.string().uuid(),
  projectId: z.string().uuid().optional().or(z.literal("")),
});

interface RecordStructure {
  title?: string;
  description?: string | null;
  priority?: string | null;
  eventType?: string | null;
  progressSummary?: string | null;
  reportType?: string | null;
}

/**
 * Copies structure into a new record. Owners, history, and private notes are
 * not on the template, so they cannot come along.
 */
export async function instantiateRecordTemplate(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  if (!staff.ok) return { ok: false, error: staff.error };
  const parsed = instantiateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid template." };
  const projectId = parsed.data.projectId || null;

  const db = await createSupabaseServerClient();
  const { data: template } = await db
    .from("record_template")
    .select("id, kind, name, structure, approved_at")
    .eq("id", parsed.data.templateId)
    .eq("organization_id", staff.session.organizationId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };
  if (!template.approved_at) {
    return { ok: false, error: "This template has not been approved yet, so it cannot be used." };
  }

  const structure = (template.structure ?? {}) as RecordStructure;
  const title = (structure.title || template.name).slice(0, 200);
  const description = structure.description || null;

  if (template.kind === "task") {
    let programId: string | null = null;
    if (projectId) {
      const { data: project } = await db
        .from("project")
        .select("program_id")
        .eq("id", projectId)
        .maybeSingle();
      programId = (project?.program_id as string | null) ?? null;
    }
    const { data, error } = await db
      .from("task")
      .insert({
        organization_id: staff.session.organizationId,
        program_id: programId,
        project_id: projectId,
        title,
        description,
        priority: structure.priority || "medium",
        requester_id: staff.session.userId,
        created_by: staff.session.userId,
        status: "not_started",
      })
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Could not create the task." };
    revalidatePath("/my-work");
    return { ok: true, id: data.id as string };
  }

  if (template.kind === "event") {
    const starts = new Date();
    const ends = new Date(starts.getTime() + 60 * 60_000);
    const { data, error } = await db
      .from("event")
      .insert({
        organization_id: staff.session.organizationId,
        project_id: projectId,
        name: title,
        description,
        owner_id: staff.session.userId,
        event_type: structure.eventType || null,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        created_by: staff.session.userId,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Could not create the event." };
    revalidatePath("/events");
    return { ok: true, id: data.id as string };
  }

  if (template.kind === "update") {
    if (!projectId) return { ok: false, error: "Choose the project this update belongs to." };
    const { error } = await db.from("project_status_update").insert({
      project_id: projectId,
      author_id: staff.session.userId,
      health: "on_track",
      progress_summary: structure.progressSummary || title,
    });
    if (error) return { ok: false, error: "Could not create the update." };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("report_instance")
    .insert({
      organization_id: staff.session.organizationId,
      report_type: structure.reportType || "activity",
      title,
      project_id: projectId,
      period_start: today,
      period_end: today,
      snapshot: {},
      status: "draft",
      generated_by: staff.session.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Could not create the report." };
  revalidatePath("/reports");
  return { ok: true, id: data.id as string };
}
