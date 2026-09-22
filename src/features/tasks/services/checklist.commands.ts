"use server";

import { revalidatePath } from "next/cache";
import { readAll } from "@/lib/supabase/read-all";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { calendarDateInZone } from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  checklistItemSchema,
  checklistReorderSchema,
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

export async function removeChecklistItem(itemId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  // `checklist_delete` already gates this on manage-or-collaborate over the
  // parent task, so an unauthorized caller deletes nothing and gets no error.
  // Ask for the row back to tell "not allowed" apart from "already gone".
  const { data, error } = await supabase
    .from("checklist_item")
    .delete()
    .eq("id", itemId)
    .select("id");
  if (error) return { ok: false, error: "Could not remove the checklist item." };
  if (!data?.length) return { ok: false, error: "That checklist item is no longer yours to remove." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Persist an arrangement the person made (P1-TSK-10).
 *
 * The caller sends the full ordered list; positions are rewritten as 1..n so
 * the stored keys never drift into the fractional values that repeated
 * single-item moves would otherwise accumulate. Items belonging to another
 * task are filtered out rather than trusted, because the ids arrive from the
 * client and `sort_key` carries no task of its own.
 */
export async function reorderChecklist(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = checklistReorderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }
  const { taskId, itemIds } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: owned, error: readError } = await supabase
    .from("checklist_item")
    .select("id")
    .eq("task_id", taskId);
  if (readError) return { ok: false, error: "Could not reorder the checklist. Please retry." };

  const ownedIds = new Set((owned ?? []).map(row => row.id as string));
  const ordered = itemIds.filter(id => ownedIds.has(id));
  if (!ordered.length) return { ok: false, error: "Could not reorder the checklist. Please retry." };

  for (const [index, id] of ordered.entries()) {
    const { error } = await supabase
      .from("checklist_item")
      .update({ sort_key: index + 1 })
      .eq("id", id)
      .eq("task_id", taskId);
    if (error) return { ok: false, error: "Could not reorder the checklist. Please retry." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addTaskDependency(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = taskDependencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick two valid tasks." };
  const { blockingTaskId, blockedTaskId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await readAll(supabase
    .from("task_dependency")
    .select("blocking_task_id, blocked_task_id")
    .order("blocked_task_id"), "blocking_task_id");
  if (readError) return { ok: false, error: "Could not check dependencies. Please retry." };
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
  if (error?.code === "23514") return { ok: false, error: "That dependency would create a cycle." };
  if (error) return { ok: false, error: "Could not save the dependency." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeTaskDependency(
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<ActionResult> {
  await requireSession();
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
  const session = await requireSession();
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid recurrence." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task")
    .update({
      recurrence_rule: parsed.data.recurrenceRule || null,
      // The anchor every future occurrence is counted from, so it has to be
      // the workspace's date. Anchored a day late, a weekly task lands on the
      // wrong weekday for as long as the series lives.
      recurrence_anchor: parsed.data.recurrenceRule
        ? (calendarDateInZone(new Date(), session.timeZone) ??
           new Date().toISOString().slice(0, 10))
        : null,
    })
    .eq("id", parsed.data.taskId);
  if (error) return { ok: false, error: "Could not set recurrence." };
  revalidatePath("/", "layout");
  return { ok: true };
}
