"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  checklistItemSchema,
  circularDependencyError,
  taskDependencySchema,
} from "@/features/tasks/schemas";

export async function addChecklistItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = checklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_item")
    .insert({
      task_id: parsed.data.taskId,
      title: parsed.data.title,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not add the checklist item." };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function toggleChecklistItem(
  itemId: string,
  completed: boolean,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("checklist_item")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) return { ok: false, error: "Could not update the checklist item." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addTaskDependency(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = taskDependencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick two valid tasks." };
  const { blockingTaskId, blockedTaskId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("task_dependency")
    .select("blocking_task_id, blocked_task_id")
    .or(
      `blocking_task_id.eq.${blockingTaskId},blocked_task_id.eq.${blockingTaskId},blocking_task_id.eq.${blockedTaskId},blocked_task_id.eq.${blockedTaskId}`,
    );
  const cycle = circularDependencyError(
    blockingTaskId,
    blockedTaskId,
    (existing ?? []) as { blocking_task_id: string; blocked_task_id: string }[],
  );
  if (cycle) return { ok: false, error: cycle };

  const { error } = await supabase.from("task_dependency").insert({
    blocking_task_id: blockingTaskId,
    blocked_task_id: blockedTaskId,
  });
  if (error?.code === "23505") return { ok: true };
  if (error) return { ok: false, error: "Could not save the dependency." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeTaskDependency(
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_dependency")
    .delete()
    .eq("blocking_task_id", blockingTaskId)
    .eq("blocked_task_id", blockedTaskId);
  if (error) return { ok: false, error: "Could not remove the dependency." };
  revalidatePath("/", "layout");
  return { ok: true };
}

const recurrenceSchema = z.object({
  taskId: z.string().uuid(),
  recurrenceRule: z.enum(["", "weekly", "monthly"]).optional(),
});

export async function setTaskRecurrence(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid recurrence." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task")
    .update({
      recurrence_rule: parsed.data.recurrenceRule || null,
      recurrence_anchor: parsed.data.recurrenceRule ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", parsed.data.taskId);
  if (error) return { ok: false, error: "Could not set recurrence." };
  revalidatePath("/", "layout");
  return { ok: true };
}
