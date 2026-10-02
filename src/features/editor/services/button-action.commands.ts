"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createEditorT } from "@/features/editor/i18n";
import { createRequestActionRegistry } from "@/features/objects/actions/server";
import { SET_PROPERTY_ACTION } from "@/features/objects/actions/set-property";
import { TASK_CREATE_ACTION } from "@/features/objects/actions/task-create";

/**
 * Button blocks (U5b): a button runs one action from the registry (plan A8),
 * so the capability check, the change set (and its undo) and the object
 * events are the same as for bulk edit, workflows and the API. Only actions
 * the registry has registered are offered, and each takes only the
 * arguments listed here.
 */

export type ButtonActionResult =
  | { ok: true; changeSetId: string | null; message: string; href: string | null }
  | { ok: false; error: string };

const BUTTON_ACTIONS: readonly string[] = [TASK_CREATE_ACTION, SET_PROPERTY_ACTION];

const idSchema = z.string().uuid();

const argsSchema = z.discriminatedUnion("actionKey", [
  z.object({
    actionKey: z.literal(TASK_CREATE_ACTION),
    args: z.object({
      title: z.string().trim().min(1).max(300),
      projectId: z.union([idSchema, z.literal("")]).optional(),
    }),
  }),
  z.object({
    actionKey: z.literal(SET_PROPERTY_ACTION),
    args: z.object({
      objectId: idSchema,
      property: z.string().trim().regex(/^[a-z][a-z0-9_]{0,62}$/),
      // Left blank, the button clears the property.
      value: z.string().max(2000).default(""),
    }),
  }),
]);

/** The page or meeting the button sits in, recorded as a new task's source. */
const sourceSchema = z.object({ type: z.enum(["page", "meeting"]), id: idSchema }).optional();

async function ready() {
  if (!(await isEnabled("wos_editor"))) return null;
  return requireSession();
}

export async function runButtonAction(
  actionKeyInput: unknown,
  argsInput: unknown,
  sourceInput?: unknown,
): Promise<ButtonActionResult> {
  const t = createEditorT(await getLocale());
  const session = await ready();
  if (!session) return { ok: false, error: t("button.errors.failed") };
  const limited =
    (await enforceRateLimit("editor:save", session.userId)) ??
    (actionKeyInput === TASK_CREATE_ACTION ? await enforceRateLimit("task:create", session.userId) : null);
  if (limited) return { ok: false, error: limited.error };
  const parsed = argsSchema.safeParse({ actionKey: actionKeyInput, args: argsInput });
  const source = sourceSchema.safeParse(sourceInput ?? undefined);
  if (!parsed.success || !source.success) return { ok: false, error: t("button.errors.invalid") };

  const created: { taskId: string | null } = { taskId: null };
  const { registry, context } = await createRequestActionRegistry(session.userId, {
    taskActor: {
      userId: session.userId,
      organizationId: session.organizationId,
      displayName: session.profile.full_name,
    },
    onTaskCreated: (id) => {
      created.taskId = id;
    },
  });
  if (!registry.get(parsed.data.actionKey)) return { ok: false, error: t("button.errors.invalid") };

  if (parsed.data.actionKey === TASK_CREATE_ACTION) {
    const { title, projectId } = parsed.data.args;
    const result = await registry.run(
      TASK_CREATE_ACTION,
      { title, ...(projectId ? { projectId } : {}), ...(source.data ? { source: source.data } : {}) },
      context,
    );
    const taskId = created.taskId;
    const href = taskId ? `/my-work?task=${taskId}` : null;
    if (result.ok) return { ok: true, changeSetId: result.changeSet.id, message: t("button.taskCreated", { title }), href };
    // The task exists but its change set could not be written: say so
    // (without an undo) rather than invite a second click and a duplicate.
    if (taskId) return { ok: true, changeSetId: null, message: t("button.taskCreated", { title }), href };
    return { ok: false, error: t(result.reason === "forbidden" ? "button.errors.forbidden" : "button.errors.failed") };
  }

  const { objectId, property, value } = parsed.data.args;
  const objectType = (await readTarget(objectId))?.type;
  if (!objectType) return { ok: false, error: t("button.errors.forbidden") };
  const result = await registry.run(
    SET_PROPERTY_ACTION,
    { objectIds: [objectId], property, value: value === "" ? null : value, objectType },
    context,
  );
  if (!result.ok) return { ok: false, error: t(result.reason === "forbidden" ? "button.errors.forbidden" : "button.errors.failed") };
  return { ok: true, changeSetId: result.changeSet.id, message: t("button.propertySet", { property }), href: null };
}

/** The object a set-property button changes, read as the viewer: its type key and title. */
async function readTarget(objectId: string): Promise<{ type: string; title: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("object")
    .select("title, type:object_type!object_type_id_organization_id_fkey(key)")
    .eq("id", objectId)
    .maybeSingle();
  const row = data as { title: string | null; type: { key: string } | { key: string }[] | null } | null;
  const type = (Array.isArray(row?.type) ? row.type[0] : row?.type)?.key;
  return type ? { type, title: (row?.title ?? "").trim() || "—" } : null;
}

/** The title of the item a set-property button changes, for its confirmation; null when not visible. */
export async function describeButtonTarget(objectIdInput: unknown): Promise<string | null> {
  const objectId = idSchema.safeParse(objectIdInput);
  if (!objectId.success || !(await ready())) return null;
  return (await readTarget(objectId.data))?.title ?? null;
}

/**
 * Undoes a button's run: only a change set this person's button made (one
 * of the button actions, by them), through the registry's own undo, which
 * checks the capability again and refuses when something changed since.
 */
export async function undoButtonAction(changeSetIdInput: unknown): Promise<{ ok: boolean }> {
  const changeSetId = idSchema.safeParse(changeSetIdInput);
  const session = await ready();
  if (!session || !changeSetId.success) return { ok: false };
  if (await enforceRateLimit("editor:save", session.userId)) return { ok: false };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("change_set").select("action_key, actor_id").eq("id", changeSetId.data).maybeSingle();
  if (!data || data.actor_id !== session.userId || !BUTTON_ACTIONS.includes(data.action_key as string)) return { ok: false };
  const { registry, context } = await createRequestActionRegistry(session.userId);
  return { ok: (await registry.undo(changeSetId.data, context)).ok };
}
