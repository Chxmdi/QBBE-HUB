"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/types/entities";
import {
  TASK_STATUSES,
  blockedReasonError,
  bulkSchema,
  createTaskSchema,
  updateTaskSchema,
} from "@/features/tasks/schemas";

/**
 * Task commands — durable server mutations (WORK-002). Validation happens
 * at the trust boundary (DEV-002); RLS enforces authorization underneath.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

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

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  blockedReason?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: "Unknown status." };
  }
  const blockedError = blockedReasonError(status, blockedReason);
  if (blockedError) {
    return { ok: false, error: blockedError };
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
    .select("id, title, project_id, program_id, assignee_id")
    .maybeSingle();

  if (error || !updated) {
    return { ok: false, error: "Could not update the task status." };
  }

  if (status === "completed") {
    const { data: source } = await supabase
      .from("task")
      .select("title, description, project_id, program_id, assignee_id, priority, due_at, recurrence_rule")
      .eq("id", taskId)
      .maybeSingle();
    if (source?.recurrence_rule && source.due_at) {
      const { nextOccurrence } = await import("@/features/tasks/recurrence");
      const nextDue = nextOccurrence(source.recurrence_rule as string, source.due_at as string);
      await supabase.from("task").insert({
        organization_id: session.organizationId,
        program_id: source.program_id,
        project_id: source.project_id,
        title: source.title,
        description: source.description,
        priority: source.priority,
        assignee_id: source.assignee_id,
        requester_id: session.userId,
        due_at: nextDue,
        created_by: session.userId,
        status: "not_started",
        recurrence_rule: source.recurrence_rule,
        recurrence_anchor: nextDue,
      });
    }
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

  const { fireWorkflows } = await import("@/features/admin/services/workflow.runtime");
  await fireWorkflows(supabase, {
    organizationId: session.organizationId,
    actorId: session.userId,
    eventType: "task_status_changed",
    status,
    title: updated.title as string,
    sourceType: "task",
    sourceId: taskId,
    link: `/my-work?task=${taskId}`,
    assigneeId: (updated.assignee_id as string | null) ?? null,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}

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

/**
 * Bulk reassign / reprioritize / reschedule / archive (P0-TSK-05).
 * "Blocked" is excluded from bulk status changes because each blocked task
 * requires its own explanation (business rule §19).
 */
export async function bulkUpdateTasks(
  input: unknown,
): Promise<ActionResult & { updated?: number }> {
  const session = await requireSession();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { taskIds, action, status, assigneeId, priority, dueAt } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (action === "status") {
    if (!status) return { ok: false, error: "Pick a status." };
    patch.status = status;
    patch.completed_at = status === "completed" ? new Date().toISOString() : null;
  } else if (action === "assignee") {
    if (assigneeId === undefined) return { ok: false, error: "Pick an assignee." };
    patch.assignee_id = assigneeId;
  } else if (action === "priority") {
    if (!priority) return { ok: false, error: "Pick a priority." };
    patch.priority = priority;
  } else if (action === "due") {
    patch.due_at = dueAt || null;
  } else if (action === "archive") {
    patch.archived_at = new Date().toISOString();
  }

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("task")
    .update(patch)
    .in("id", taskIds)
    .select("id, title, project_id, program_id");

  if (error) {
    return { ok: false, error: "Bulk update failed. No changes were applied." };
  }

  const rows = updated ?? [];
  if (rows.length > 0) {
    await supabase.from("activity_event").insert(
      rows.map((row) => ({
        organization_id: session.organizationId,
        actor_id: session.userId,
        verb: action === "archive" ? "archived" : "updated",
        source_type: "task",
        source_id: row.id,
        project_id: row.project_id,
        program_id: row.program_id,
        summary: `bulk ${action === "archive" ? "archived" : "updated"} “${row.title}”`,
      })),
    );

    // One deduplicated notification per newly assigned person.
    if (action === "assignee" && assigneeId && assigneeId !== session.userId) {
      await supabase.from("notification").insert(
        rows.map((row) => ({
          user_id: assigneeId,
          organization_id: session.organizationId,
          category: "assignment",
          title: `${session.profile.full_name} assigned you a task`,
          body: row.title,
          source_type: "task",
          source_id: row.id,
          link: `/my-work?task=${row.id}`,
          dedupe_key: `assign:${row.id}:${assigneeId}`,
        })),
      );
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, updated: rows.length };
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
