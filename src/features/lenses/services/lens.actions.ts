"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/query/run";
import type { LensCatalog } from "@/lib/query/catalog";
import { updateTask, updateTaskStatus, type ActionResult } from "@/features/tasks/services/task.commands";
import { TASK_STATUSES } from "@/features/tasks/schemas";
import type { TaskStatus } from "@/types/entities";
import { getLensT } from "@/features/lenses/i18n/server";
import type { LensT } from "@/features/lenses/i18n";
import { createRequestActionRegistry } from "@/features/objects/actions/server";
import { SET_PROPERTY_ACTION } from "@/features/objects/actions/set-property";
import { cellEditorFor, parseCellInput, PASTE_LIMIT, storedValue } from "@/features/lenses/table/editable";
import { isCalendarDate } from "@/lib/schema";

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
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("due"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate).nullable() }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("assignee"), value: uuid.nullable() }),
  z.object({ type: z.literal("task"), id: uuid, property: z.literal("reviewer"), value: uuid.nullable() }),
]);

/** A saved cell; `changeSetId` is set when the change can be undone (wave 2 unit D1). */
export type CellResult = ActionResult & { changeSetId?: string };

export async function updateLensCell(input: unknown): Promise<CellResult> {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  if (!(await isEnabled("wos_lenses", supabase))) return { ok: false, error: t("table.readOnly") };
  // Wave 2 unit D1: with the object layer on, every property the table can
  // edit is saved as a change set (object.set_property) that can be undone.
  if (await isEnabled("wos_objects", supabase)) {
    const limited = await enforceRateLimit("property:write", session.userId);
    if (limited) return limited;
    const parsed = d1CellSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("table.readOnly") };
    const catalog = await loadCatalog(supabase).catch(() => null);
    if (!catalog) return { ok: false, error: t("common.loadFailed") };
    const result = await saveCell(supabase, session.userId, catalog, parsed.data.type, parsed.data, t, await createRequestActionRegistry(session.userId));
    return result.ok ? { ok: true, ...(result.changeSetId ? { changeSetId: result.changeSetId } : {}) } : { ok: false, error: result.error };
  }
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

// ---------------------------------------------------------------------------
// Wave 2 unit D1: cells as change sets (switches wos_lenses + wos_objects)
// ---------------------------------------------------------------------------

const KEY = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const d1Cell = z.object({ id: uuid, property: KEY, value: z.string().max(4000).nullable() });
const d1CellSchema = d1Cell.extend({ type: KEY });

const d1PasteSchema = z.object({ type: KEY, cells: z.array(d1Cell).min(1).max(PASTE_LIMIT) });
const d1UndoSchema = z.object({ changeSetIds: z.array(uuid).min(1).max(PASTE_LIMIT) });

type SavedCell = { ok: true; changeSetId: string | null } | { ok: false; error: string; refused: boolean };
type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Registry = Awaited<ReturnType<typeof createRequestActionRegistry>>;

/**
 * Task fields the task screens already save through a command: the table uses
 * the same command, so notifications, task history, completion and the next
 * occurrence of a recurring task happen exactly as from the task drawer. The
 * command records its own change set (task.change-sets.ts).
 */
const TASK_COMMANDS: Record<string, (taskId: string, value: string | null) => Promise<ActionResult>> = {
  title: (taskId, value) => updateTask({ taskId, title: value }),
  priority: (taskId, value) => updateTask({ taskId, priority: value }),
  due: (taskId, value) => updateTask({ taskId, dueAt: value }),
  assignee: (taskId, value) => updateTask({ taskId, assigneeId: value }),
  reviewer: (taskId, value) => updateTask({ taskId, reviewerId: value }),
  approver: (taskId, value) => updateTask({ taskId, approverId: value }),
  project: (taskId, value) => updateTask({ taskId, projectId: value }),
  milestone: (taskId, value) => updateTask({ taskId, milestoneId: value }),
  status: (taskId, value) => updateTaskStatus(taskId, value as TaskStatus),
};

/** The newest change set this person recorded on a record (RLS: only their own or visible ones). */
async function latestChangeSet(client: ServerClient, userId: string, objectId: string): Promise<string | null> {
  const { data } = await client
    .from("change_set")
    .select("id, change_set_item!inner(object_id)")
    .eq("change_set_item.object_id", objectId)
    .eq("actor_id", userId)
    .is("undo_of", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data as { id: string }[] | null) ?? [])[0]?.id ?? null;
}

/**
 * One cell. The value is checked again here, whatever the browser said: the
 * property must be one the table edits, and the value must fit it. Task
 * fields with a command go through it (after the same edit_content check the
 * action makes); everything else goes through object.set_property, as the
 * record page does (U14). Either way the change is a change set.
 */
async function saveCell(
  client: ServerClient,
  userId: string,
  catalog: LensCatalog,
  type: string,
  cell: z.infer<typeof d1Cell>,
  t: LensT,
  registry: Registry,
): Promise<SavedCell> {
  const kind = cellEditorFor(type, cell.property);
  const property = catalog[type]?.properties.find((p) => p.key === cell.property);
  if (!kind || !property) return { ok: false, error: t("table.readOnly"), refused: true };
  const parsed = parseCellInput(kind, cell.value, { property: cell.property, choices: property.choices });
  if (!parsed.ok) return { ok: false, error: t(`units.d1.invalid.${parsed.error}`), refused: true };

  const command = type === "task" ? TASK_COMMANDS[cell.property] : undefined;
  if (command) {
    const { data: allowed } = await client.rpc("can", { object_id: cell.id, capability: "edit_content" });
    if (allowed !== true) return { ok: false, error: t("units.d1.forbidden"), refused: true };
    const before = await latestChangeSet(client, userId, cell.id);
    const result = await command(cell.id, parsed.raw);
    if (!result.ok) return { ok: false, error: result.error ?? t("units.d1.failed"), refused: false };
    const after = await latestChangeSet(client, userId, cell.id);
    return { ok: true, changeSetId: after !== before ? after : null };
  }

  const result = await registry.registry.run(
    SET_PROPERTY_ACTION,
    { objectIds: [cell.id], objectType: type, property: cell.property, value: storedValue(kind, parsed.raw) },
    registry.context,
  );
  if (result.ok) return { ok: true, changeSetId: result.changeSet.id };
  // The registry's own wording for a value that was already there.
  if (result.message === "Nothing changed.") return { ok: true, changeSetId: null };
  // Refused by edit_content, or by the row's own RLS when written.
  if (result.reason === "forbidden" || result.message === "forbidden") {
    return { ok: false, error: t("units.d1.forbidden"), refused: true };
  }
  return { ok: false, error: t("units.d1.failed"), refused: false };
}

/** How many records a paste saves at once; one record's cells are saved in order. */
const PASTE_CONCURRENCY = 6;

export interface PasteResult {
  ok: boolean;
  error?: string;
  saved: number;
  /** Cells the server refused: not editable by this person, or not a valid value. */
  refused: number;
  failed: number;
  changeSetIds: string[];
}

/**
 * Pasting a range: every cell is saved like an in-place edit, each as its own
 * change set (so the existing undo route can reverse any of them), and the
 * browser undoes the paste as one step. Cells the person may not edit are
 * refused one by one, never the whole paste.
 */
export async function pasteLensCells(input: unknown): Promise<PasteResult> {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  const none = { saved: 0, refused: 0, failed: 0, changeSetIds: [] };
  if (!(await isEnabled("wos_lenses", supabase)) || !(await isEnabled("wos_objects", supabase))) {
    return { ok: false, error: t("table.readOnly"), ...none };
  }
  const parsed = d1PasteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("units.d1.failed"), ...none };
  const limited = await enforceRateLimit("property:write", session.userId);
  if (limited) return { ...limited, ...none };
  const catalog = await loadCatalog(supabase).catch(() => null);
  if (!catalog) return { ok: false, error: t("common.loadFailed"), ...none };

  const registry = await createRequestActionRegistry(session.userId);
  const result: PasteResult = { ok: true, ...none, changeSetIds: [] };
  const byRecord = new Map<string, z.infer<typeof d1Cell>[]>();
  for (const cell of parsed.data.cells) byRecord.set(cell.id, [...(byRecord.get(cell.id) ?? []), cell]);
  const queue = [...byRecord.values()];
  const worker = async () => {
    for (let cells = queue.shift(); cells; cells = queue.shift()) {
      for (const cell of cells) {
        const saved = await saveCell(supabase, session.userId, catalog, parsed.data.type, cell, t, registry);
        if (saved.ok) {
          result.saved += 1;
          if (saved.changeSetId) result.changeSetIds.push(saved.changeSetId);
        } else if (saved.refused) {
          result.refused += 1;
        } else {
          result.failed += 1;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PASTE_CONCURRENCY, queue.length) }, worker));
  return result;
}

export interface UndoCellsResult {
  ok: boolean;
  error?: string;
  /** How many were undone, newest first; the rest are unchanged and can be tried again. */
  undone: number;
  /** Someone changed a value since, so trying again would not help. */
  conflict?: boolean;
}

/**
 * Undoes cell changes, newest first, through the same registry as
 * POST /api/objects/change-sets/:id/undo: refused when the person may no
 * longer edit the record, or when someone changed the value since.
 */
export async function undoLensCells(input: unknown): Promise<UndoCellsResult> {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  if (!(await isEnabled("wos_lenses", supabase)) || !(await isEnabled("wos_objects", supabase))) {
    return { ok: false, error: t("units.d1.undoFailed"), undone: 0 };
  }
  const parsed = d1UndoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("units.d1.undoFailed"), undone: 0 };
  const limited = await enforceRateLimit("property:write", session.userId);
  if (limited) return { ...limited, undone: 0 };

  const { registry, context } = await createRequestActionRegistry(session.userId);
  let undone = 0;
  for (const id of [...parsed.data.changeSetIds].reverse()) {
    const result = await registry.undo(id, context);
    if (!result.ok) {
      const conflict = result.message?.startsWith("conflict:") === true;
      const error = conflict ? t("units.d1.undoConflict") : result.reason === "forbidden" ? t("units.d1.forbidden") : t("units.d1.undoFailed");
      return { ok: false, error, undone, ...(conflict ? { conflict } : {}) };
    }
    undone += 1;
  }
  return { ok: true, undone };
}
