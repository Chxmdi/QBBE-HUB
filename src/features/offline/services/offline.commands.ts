"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUniversalTask } from "@/features/universal-tasks/create-task";
import {
  OFFLINE_FIELDS,
  compact,
  decideField,
  isValidValue,
  type OfflineOperation,
  type SyncOutcome,
} from "@/features/offline/op-log";

const MAX_OPS = 200;

const opSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().uuid(),
    kind: z.literal("set_field"),
    createdAt: z.string().datetime(),
    taskId: z.string().uuid(),
    taskTitle: z.string().max(300),
    field: z.enum(OFFLINE_FIELDS),
    value: z.string().max(300).nullable(),
    base: z.string().max(300).nullable(),
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal("create_task"),
    createdAt: z.string().datetime(),
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(300),
    projectId: z.string().uuid().nullable(),
  }),
]);

/**
 * Sends the device's queued changes. Every change runs as the person, under
 * the task table's own rules, so working offline never grants anything; each
 * field is settled latest-wins (decideField) and every overwrite comes back
 * for review.
 */
export async function syncOfflineOperations(input: unknown): Promise<{ ok: true; outcomes: SyncOutcome[] } | { ok: false; error: "disabled" | "invalid" }> {
  if (!(await isEnabled("wos_offline"))) return { ok: false, error: "disabled" };
  const session = await requireSession();
  const parsed = z.array(opSchema).max(MAX_OPS).safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createSupabaseServerClient();
  const ops = parsed.data as OfflineOperation[];
  // Edits to one field that compaction folded away still count as done.
  const kept = compact(ops);
  const keptIds = new Set(kept.map((op) => op.id));
  const outcomes: SyncOutcome[] = ops.filter((op) => !keptIds.has(op.id)).map((op) => ({ opId: op.id, result: "already" as const }));

  for (const op of kept) {
    if (op.kind === "create_task") {
      const { data: existing } = await supabase.from("task").select("id").eq("id", op.taskId).maybeSingle();
      if (existing) {
        outcomes.push({ opId: op.id, result: "already" });
        continue;
      }
      const created = await createUniversalTask(
        supabase,
        { userId: session.userId, organizationId: session.organizationId, displayName: session.profile?.full_name ?? "" },
        { title: op.title, ...(op.projectId ? { projectId: op.projectId } : {}) },
        { extra: { id: op.taskId }, activitySummary: `created task “${op.title}” while offline` },
      );
      outcomes.push(created.ok ? { opId: op.id, result: "applied" } : { opId: op.id, result: "failed", reason: "forbidden" });
      continue;
    }

    if (!isValidValue(op.field, op.value)) {
      outcomes.push({ opId: op.id, result: "failed", reason: "invalid" });
      continue;
    }
    const { data: row } = await supabase
      .from("task")
      .select(`id, title, project_id, program_id, updated_at, ${op.field}`)
      .eq("id", op.taskId)
      .maybeSingle();
    if (!row) {
      outcomes.push({ opId: op.id, result: "failed", reason: "missing" });
      continue;
    }
    const record = row as unknown as Record<string, string | null>;
    const serverValue = (record[op.field] ?? null) as string | null;
    const decision = decideField(op, { value: serverValue, changedAt: record.updated_at as string });
    const review = {
      opId: op.id,
      taskId: op.taskId,
      taskTitle: (record.title as string) ?? op.taskTitle,
      field: op.field,
    };
    if (decision.action === "already") {
      outcomes.push({ opId: op.id, result: "already" });
      continue;
    }
    if (decision.action === "keep_server") {
      outcomes.push({ opId: op.id, result: "kept_server", review: { ...review, kept: serverValue, overwritten: op.value, winner: "server" } });
      continue;
    }

    const patch: Record<string, unknown> = { [op.field]: op.value };
    if (op.field === "status") patch.completed_at = op.value === "completed" ? new Date().toISOString() : null;
    // Conditional on the value just read, so a change that lands in between
    // is never silently overwritten; the next sync settles it again.
    let update = supabase.from("task").update(patch).eq("id", op.taskId);
    update = serverValue === null ? update.is(op.field, null) : update.eq(op.field, serverValue);
    const { data: updated, error } = await update.select("id");
    if (error || !updated?.length) {
      outcomes.push({ opId: op.id, result: "failed", reason: error?.code === "42501" || !error ? "forbidden" : "invalid" });
      continue;
    }
    await supabase.from("activity_event").insert({
      organization_id: session.organizationId,
      actor_id: session.userId,
      verb: "updated",
      source_type: "task",
      source_id: op.taskId,
      project_id: record.project_id,
      program_id: record.program_id,
      summary: `changed ${op.field.replace("_at", "")} on “${review.taskTitle}” (made offline)`,
      metadata: { changes: [{ field: op.field, from: serverValue, to: op.value }], offline: true },
    });
    outcomes.push(
      decision.changedByOthers
        ? { opId: op.id, result: "replaced_server", review: { ...review, kept: op.value, overwritten: serverValue, winner: "device" } }
        : { opId: op.id, result: "applied" },
    );
  }
  revalidatePath("/offline");
  return { ok: true, outcomes };
}
