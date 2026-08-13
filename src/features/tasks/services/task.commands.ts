"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/types/entities";

/**
 * Task commands — durable server mutations (WORK-002). Validation happens
 * at the trust boundary (DEV-002); RLS enforces authorization underneath.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "A task needs a title.").max(300),
  description: z.string().trim().max(5000).optional(),
  projectId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dueAt: z.string().optional(),
});

export async function createTask(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, description, projectId, milestoneId, assigneeId, priority, dueAt } =
    parsed.data;

  const supabase = await createSupabaseServerClient();

  let programId: string | null = null;
  if (projectId) {
    const { data: project } = await supabase
      .from("project")
      .select("program_id")
      .eq("id", projectId)
      .maybeSingle();
    programId = (project?.program_id as string | null) ?? null;
  }

  const { data: task, error } = await supabase
    .from("task")
    .insert({
      organization_id: session.organizationId,
      program_id: programId,
      project_id: projectId ?? null,
      milestone_id: milestoneId ?? null,
      title,
      description: description || null,
      priority,
      assignee_id: assigneeId ?? null,
      requester_id: session.userId,
      due_at: dueAt || null,
      created_by: session.userId,
      status: "not_started",
    })
    .select("id")
    .single();

  if (error || !task) {
    return { ok: false, error: "Could not save the task. Please try again." };
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "task",
    source_id: task.id,
    project_id: projectId ?? null,
    program_id: programId,
    summary: `created task “${title}”`,
  });

  // Deduplicated assignment notification (P0-NOT-04): one per task+assignee.
  if (assigneeId && assigneeId !== session.userId) {
    await supabase.from("notification").insert({
      user_id: assigneeId,
      organization_id: session.organizationId,
      category: "assignment",
      title: `${session.profile.full_name} assigned you a task`,
      body: title,
      source_type: "task",
      source_id: task.id,
      link: `/my-work?task=${task.id}`,
      urgency: priority === "critical" ? "high" : "normal",
      dedupe_key: `assign:${task.id}:${assigneeId}`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true, id: task.id as string };
}

const VALID_STATUSES: TaskStatus[] = [
  "not_started", "ready", "in_progress", "waiting", "blocked",
  "in_review", "completed", "cancelled",
];

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  blockedReason?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, error: "Unknown status." };
  }
  if (status === "blocked" && !blockedReason?.trim()) {
    // Business rule §19: blocked work requires an explanation.
    return { ok: false, error: "Marking a task blocked requires a reason." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("task")
    .update({
      status,
      blocked_reason: status === "blocked" ? blockedReason!.trim() : null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .select("id, title, project_id, program_id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "Could not update the task status." };
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: status === "completed" ? "completed" : "updated",
    source_type: "task",
    source_id: taskId,
    project_id: updated.project_id,
    program_id: updated.program_id,
    summary:
      status === "completed"
        ? `completed “${updated.title}”`
        : `moved “${updated.title}” to ${status.replace(/_/g, " ")}`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});

export async function updateTask(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, ...fields } = parsed.data;

  const supabase = await createSupabaseServerClient();

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.assigneeId !== undefined) patch.assignee_id = fields.assigneeId;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.dueAt !== undefined) patch.due_at = fields.dueAt || null;
  if (fields.projectId !== undefined) patch.project_id = fields.projectId;

  const { data: updated, error } = await supabase
    .from("task")
    .update(patch)
    .eq("id", taskId)
    .select("id, title, assignee_id, project_id, program_id")
    .maybeSingle();

  if (error || !updated) return { ok: false, error: "Could not update the task." };

  if (fields.assigneeId && fields.assigneeId !== session.userId) {
    await supabase.from("notification").insert({
      user_id: fields.assigneeId,
      organization_id: session.organizationId,
      category: "assignment",
      title: `${session.profile.full_name} assigned you a task`,
      body: updated.title,
      source_type: "task",
      source_id: taskId,
      link: `/my-work?task=${taskId}`,
      dedupe_key: `assign:${taskId}:${fields.assigneeId}`,
    });
  }

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "task",
    source_id: taskId,
    project_id: updated.project_id,
    program_id: updated.program_id,
    summary: `updated “${updated.title}”`,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addTaskComment(
  taskId: string,
  body: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Comment cannot be empty." };
  if (trimmed.length > 5000) return { ok: false, error: "Comment is too long." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("task_comment").insert({
    task_id: taskId,
    author_id: session.userId,
    body: trimmed,
  });
  if (error) return { ok: false, error: "Could not post the comment." };

  // Notify assignee about new discussion, deduplicated per comment author.
  const { data: task } = await supabase
    .from("task")
    .select("title, assignee_id, project_id, program_id")
    .eq("id", taskId)
    .maybeSingle();

  if (task?.assignee_id && task.assignee_id !== session.userId) {
    await supabase.from("notification").insert({
      user_id: task.assignee_id,
      organization_id: session.organizationId,
      category: "reply",
      title: `${session.profile.full_name} commented on “${task.title}”`,
      body: trimmed.slice(0, 140),
      source_type: "task",
      source_id: taskId,
      link: `/my-work?task=${taskId}`,
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
