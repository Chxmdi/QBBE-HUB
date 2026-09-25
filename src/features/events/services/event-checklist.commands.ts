"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * The preparation checklist P0-EVT-01 asks an event to carry.
 *
 * `event_checklist_item` has existed with read and write policies since
 * `20260912040000`, and nothing in the application referenced it — a table, its
 * RLS and no way to put a row in it. These commands are that way.
 *
 * Authorization is not repeated here. `event_checklist_write` is
 * `app.can_manage_event(event_id)` on both `using` and `with check`, so a
 * caller who may not manage the event writes nothing. What these add is the
 * ability to tell "not allowed" apart from "already gone", which PostgREST
 * reports identically as a no-op, by asking for the affected row back.
 */

const addItemSchema = z.object({
  eventId: z.string().uuid(),
  title: requiredText("A checklist item needs a description.", 300),
});

export async function addEventChecklistItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();

  // Position after whatever is already there, so a new item does not land in
  // the middle of a list somebody has arranged. The same reasoning as
  // `20260921190000_position_new_checklist_items.sql` for task checklists,
  // done here in the command because this table has no trigger for it.
  const { data: last } = await supabase
    .from("event_checklist_item")
    .select("sort_key")
    .eq("event_id", parsed.data.eventId)
    .order("sort_key", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSortKey = ((last?.sort_key as number | undefined) ?? 0) + 1;

  const { data, error } = await supabase
    .from("event_checklist_item")
    .insert({
      event_id: parsed.data.eventId,
      title: parsed.data.title,
      sort_key: nextSortKey,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: "Could not add the checklist item." };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function toggleEventChecklistItem(
  itemId: string,
  completed: boolean,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_checklist_item")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", itemId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Could not update the checklist item." };
  if (!data) return { ok: false, error: "That checklist item is no longer available." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeEventChecklistItem(itemId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("event_checklist_item")
    .delete()
    .eq("id", itemId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Could not remove the checklist item." };
  if (!data) return { ok: false, error: "That checklist item is no longer available." };
  revalidatePath("/", "layout");
  return { ok: true };
}
