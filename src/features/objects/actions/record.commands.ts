"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createObjectsTranslator, type ObjectsKey } from "../i18n/translate";
import { createRequestActionRegistry } from "./server";
import { SET_PROPERTY_ACTION } from "./set-property";

export type RecordWriteResult = { ok: true; changeSetId: string } | { ok: false; error: string };

const KEY = /^[a-z][a-z0-9_]{0,62}$/;

const setSchema = z.object({
  objectId: z.string().uuid(),
  objectType: z.string().regex(KEY),
  property: z.string().regex(KEY),
  value: z.unknown(),
});

const undoSchema = z.object({ changeSetId: z.string().uuid() });

/** The action's refusal, as one line in the viewer's language. */
function reasonKey(reason: "unknown_action" | "forbidden" | "failed", message?: string): ObjectsKey {
  if (reason === "forbidden") return "record.properties.forbidden";
  if (message === "Nothing changed.") return "record.properties.noChange";
  if (message?.startsWith("conflict:")) return "record.properties.conflict";
  if (message?.includes("cannot be undone")) return "record.properties.undoExpired";
  return "record.properties.failed";
}

/**
 * Sets one property of one object from the record page (U14), through the
 * object.set_property action: the change is recorded as a change set that the
 * Undo link reverses. The database decides whether the viewer may (RLS on the
 * value and app.can on the object), as it does for bulk edit.
 */
export async function setRecordProperty(input: unknown): Promise<RecordWriteResult> {
  const t = createObjectsTranslator(await getLocale());
  if (!(await isEnabled("wos_objects"))) return { ok: false, error: t("record.properties.forbidden") };
  const session = await getSessionContext();
  if (!session) return { ok: false, error: t("record.properties.forbidden") };
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("record.properties.failed") };

  const { registry, context } = await createRequestActionRegistry(session.userId);
  const result = await registry.run(
    SET_PROPERTY_ACTION,
    {
      objectIds: [parsed.data.objectId],
      objectType: parsed.data.objectType,
      property: parsed.data.property,
      value: parsed.data.value ?? null,
    },
    context,
  );
  if (!result.ok) return { ok: false, error: t(reasonKey(result.reason, result.message)) };
  return { ok: true, changeSetId: result.changeSet.id };
}

/** Undoes a change set the record page recorded; same refusals as the undo route. */
export async function undoRecordChange(input: unknown): Promise<RecordWriteResult> {
  const t = createObjectsTranslator(await getLocale());
  if (!(await isEnabled("wos_objects"))) return { ok: false, error: t("record.properties.undoFailed") };
  const session = await getSessionContext();
  if (!session) return { ok: false, error: t("record.properties.undoFailed") };
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("record.properties.undoFailed") };

  const { registry, context } = await createRequestActionRegistry(session.userId);
  const result = await registry.undo(parsed.data.changeSetId, context);
  if (!result.ok) {
    const key: ObjectsKey =
      result.reason === "forbidden"
        ? "record.properties.forbidden"
        : result.message?.startsWith("conflict:")
          ? "record.properties.conflict"
          : result.message?.includes("cannot be undone")
            ? "record.properties.undoExpired"
            : "record.properties.undoFailed";
    return { ok: false, error: t(key) };
  }
  return { ok: true, changeSetId: result.changeSet.id };
}
