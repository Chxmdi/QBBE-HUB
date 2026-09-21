"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createLabelSchema, taskLabelSchema } from "@/features/tasks/schemas";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * Label commands (P0-TSK-08).
 *
 * The tables, their policies and the filter that reads them all shipped
 * already; what was missing was any way to put a row in either one. A filter
 * over an empty table is not a partial feature, it is a control that silently
 * does nothing, which is worse than an absent one — it looks available.
 *
 * Authorization is left where it already was rather than re-checked here:
 * `label` is `app.is_org_staff` for writes, and `task_label` insert and delete
 * both require `has_task_capability(task_id, 'manage' or 'collaborate')`. A
 * volunteer who can read a task therefore cannot tag it, and the denial comes
 * from the database rather than from a check the client could be asked to
 * skip.
 */

export async function createLabel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createLabelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("label")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    .select("id")
    .single();

  if (error) {
    // (organization_id, name) is unique. Saying so is more use than "could not
    // save", because the label the person wanted already exists and they can
    // just pick it.
    if (error.code === "23505") {
      return { ok: false, error: "A label with that name already exists." };
    }
    return { ok: false, error: "Could not create the label." };
  }

  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function attachTaskLabel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = taskLabelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, labelId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_label")
    .insert({ task_id: taskId, label_id: labelId });

  // The primary key is (task_id, label_id), so attaching a label twice is a
  // duplicate, not a failure. The person asked for the label to be on the task
  // and it is.
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not add that label." };
  }

  if (!error) await recordLabelChange(supabase, session, taskId, labelId, "added");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function detachTaskLabel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = taskLabelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { taskId, labelId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("task_label")
    .delete()
    .eq("task_id", taskId)
    .eq("label_id", labelId);

  if (error) return { ok: false, error: "Could not remove that label." };

  await recordLabelChange(supabase, session, taskId, labelId, "removed");
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Labelling is a change to the task, so it belongs in the task's history.
 *
 * It is not a `TRACKED_TASK_FIELDS` diff because labels are a join table
 * rather than a column — there is no before and after value, only an addition
 * or a removal. The name is resolved now and stored in the summary, for the
 * same reason the field diff stores its labels: the entry has to stay readable
 * after the label is renamed or deleted.
 */
async function recordLabelChange(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  session: { organizationId: string; userId: string },
  taskId: string,
  labelId: string,
  action: "added" | "removed",
): Promise<void> {
  const [{ data: label }, { data: task }] = await Promise.all([
    supabase.from("label").select("name").eq("id", labelId).maybeSingle(),
    supabase
      .from("task")
      .select("title, project_id, program_id")
      .eq("id", taskId)
      .maybeSingle(),
  ]);
  if (!task) return;

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "updated",
    source_type: "task",
    source_id: taskId,
    project_id: (task.project_id as string | null) ?? null,
    program_id: (task.program_id as string | null) ?? null,
    summary:
      action === "added"
        ? `${action} label “${label?.name ?? "label"}” to “${task.title}”`
        : `${action} label “${label?.name ?? "label"}” from “${task.title}”`,
    metadata: { label_id: labelId, label_action: action },
  });
}
