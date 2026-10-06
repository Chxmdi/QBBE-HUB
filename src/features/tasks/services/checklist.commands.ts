"use server";

import { revalidatePath } from "next/cache";
import { readAll } from "@/lib/supabase/read-all";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { calendarDateInZone } from "@/lib/time";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  checklistItemSchema,
  checklistReorderSchema,
  circularDependencyError,
  taskDependencySchema,
  translateTaskError,
} from "@/features/tasks/schemas";

/**
 * The four checklist commands below do not revalidate anything, and that is
 * deliberate.
 *
 * `checklist_item` is read in exactly one place — the task drawer, from the
 * browser — so no server component's output depends on it. Calling
 * `revalidatePath("/", "layout")` here re-rendered every route's layout for
 * data none of them read, and the cost of that grew with the size of the page
 * underneath the drawer. The drawer re-reads its own data through `onChanged`
 * when a command succeeds, which is what actually puts the change on screen.
 *
 * If a checklist count is ever shown outside the drawer, this has to come
 * back — narrowed to the route that shows it.
 */
export async function addChecklistItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = checklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: translateTaskError(t, parsed.error.issues[0]?.message) ?? t("tasks.errors.invalidInput") };
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
  if (error || !data) return { ok: false, error: t("tasks.errors.addChecklistItem") };
  return { ok: true, id: data.id as string };
}

export async function toggleChecklistItem(
  itemId: string,
  completed: boolean,
): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  // Someone who can read the task but not edit it matches no row; that is a
  // refusal, not a tick that silently disappears on the next load.
  const { data: changed, error } = await supabase
    .from("checklist_item")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", itemId)
    .select("id");
  if (error || !changed || changed.length === 0) {
    return { ok: false, error: t("tasks.errors.updateChecklistItem") };
  }
  return { ok: true };
}

export async function removeChecklistItem(itemId: string): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  // `checklist_delete` already gates this on manage-or-collaborate over the
  // parent task, so an unauthorized caller deletes nothing and gets no error.
  // Ask for the row back to tell "not allowed" apart from "already gone".
  const { data, error } = await supabase
    .from("checklist_item")
    .delete()
    .eq("id", itemId)
    .select("id");
  if (error) return { ok: false, error: t("tasks.errors.removeChecklistItem") };
  if (!data?.length) return { ok: false, error: t("tasks.errors.checklistNotYours") };
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
  const t = await getT();
  const parsed = checklistReorderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: translateTaskError(t, parsed.error.issues[0]?.message) ?? t("tasks.errors.invalidOrder") };
  }
  const { taskId, itemIds } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: owned, error: readError } = await supabase
    .from("checklist_item")
    .select("id")
    .eq("task_id", taskId);
  if (readError) return { ok: false, error: t("tasks.errors.reorderChecklist") };

  const ownedIds = new Set((owned ?? []).map(row => row.id as string));
  const ordered = itemIds.filter(id => ownedIds.has(id));
  if (!ordered.length) return { ok: false, error: t("tasks.errors.reorderChecklist") };

  for (const [index, id] of ordered.entries()) {
    const { data: placed, error } = await supabase
      .from("checklist_item")
      .update({ sort_key: index + 1 })
      .eq("id", id)
      .eq("task_id", taskId)
      .select("id");
    // A reader can see the list but not reorder it; that matches no row.
    if (error || !placed || placed.length === 0) {
      return { ok: false, error: t("tasks.errors.reorderChecklist") };
    }
  }
  return { ok: true };
}

export async function addTaskDependency(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const parsed = taskDependencySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("tasks.errors.pickTwoTasks") };
  const { blockingTaskId, blockedTaskId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: existing, error: readError } = await readAll(supabase
    .from("task_dependency")
    .select("blocking_task_id, blocked_task_id")
    .order("blocked_task_id"), "blocking_task_id");
  if (readError) return { ok: false, error: t("tasks.errors.checkDependencies") };
  const cycle = circularDependencyError(
    blockingTaskId,
    blockedTaskId,
    (existing ?? []) as { blocking_task_id: string; blocked_task_id: string }[],
  );
  if (cycle) return { ok: false, error: translateTaskError(t, cycle) };

  const { error } = await supabase.from("task_dependency").insert({
    blocking_task_id: blockingTaskId,
    blocked_task_id: blockedTaskId,
  });
  if (error?.code === "23505") return { ok: true };
  if (error?.code === "23514") return { ok: false, error: t("tasks.errors.cycle") };
  if (error) return { ok: false, error: t("tasks.errors.saveDependency") };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeTaskDependency(
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_dependency")
    .delete()
    .eq("blocking_task_id", blockingTaskId)
    .eq("blocked_task_id", blockedTaskId);
  if (error) return { ok: false, error: t("tasks.errors.removeDependency") };
  revalidatePath("/", "layout");
  return { ok: true };
}

const recurrenceSchema = z.object({
  taskId: z.string().uuid(),
  recurrenceRule: z.enum(["", "weekly", "monthly"]).optional(),
});

export async function setTaskRecurrence(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("tasks.errors.invalidRecurrence") };
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
  if (error) return { ok: false, error: t("tasks.errors.setRecurrence") };
  revalidatePath("/", "layout");
  return { ok: true };
}
