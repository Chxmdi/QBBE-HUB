"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateTask, updateTaskStatus, type ActionResult } from "@/features/tasks/services/task.commands";
import { TASK_STATUSES } from "@/features/tasks/schemas";
import type { TaskStatus } from "@/types/entities";
import { getLensT } from "@/features/lenses/i18n/server";

/**
 * Server actions for the lens screens. Reads go from the browser straight to
 * the engine with the viewer's session (RLS decides the rows); every write
 * goes through the existing command for that field.
 */

const uuid = z.string().uuid();
const cellSchema = z.discriminatedUnion("property", [
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("title"), value: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("status"), value: z.enum(TASK_STATUSES as unknown as [TaskStatus, ...TaskStatus[]]) }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("priority"), value: z.enum(["low", "medium", "high", "critical"]) }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("due"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("assignee"), value: uuid.nullable() }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("reviewer"), value: uuid.nullable() }),
]);

export async function updateLensCell(input: unknown): Promise<ActionResult> {
  await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  if (!(await isEnabled("wos_lenses", supabase))) return { ok: false, error: t("table.readOnly") };
  const parsed = cellSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("table.readOnly") };
  const cell = parsed.data;
  switch (cell.property) {
    case "title":
      return updateTask({ taskId: cell.id, title: cell.value });
    case "priority":
      return updateTask({ taskId: cell.id, priority: cell.value });
    case "due":
      return updateTask({ taskId: cell.id, dueAt: cell.value });
    case "assignee":
      return updateTask({ taskId: cell.id, assigneeId: cell.value });
    case "reviewer":
      return updateTask({ taskId: cell.id, reviewerId: cell.value });
    case "status":
      return updateTaskStatus(cell.id, cell.value);
  }
}
