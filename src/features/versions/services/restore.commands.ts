"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { contentAdapterFor } from "../adapters/registry";
import { isContentSnapshot, type PropertySnapshot } from "../content";
import { restoreBlockInto } from "../diff";
import { versionsText } from "../messages";
import { getObjectVersion } from "./version.queries";

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

const restoreSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all"), versionId: z.string().uuid() }),
  z.object({ scope: z.literal("block"), versionId: z.string().uuid(), key: z.string().min(1).max(200) }),
  z.object({ scope: z.literal("property"), versionId: z.string().uuid(), key: z.string().min(1).max(200) }),
]);

/**
 * Restores the whole object, one block or one property from a version
 * (M16b). The current state is saved first as a "Before restore" version,
 * which also proves the person may edit the object; the write then goes
 * through the type's adapter, so the object's own rules and triggers apply.
 * Restoring is therefore always undoable by restoring that version.
 */
export async function restoreFromVersion(input: unknown): Promise<RestoreResult> {
  await requireSession();
  const m = versionsText(await getLocale());
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.failed };
  const request = parsed.data;

  const version = await getObjectVersion(request.versionId);
  if (!version || !isContentSnapshot(version.content)) return { ok: false, error: m.errors.notFound };
  const object = { id: version.objectId, type: version.objectType };
  const adapter = contentAdapterFor(object.type);
  if (!adapter) return { ok: false, error: m.errors.unsupported };
  const current = await adapter.read(object);
  if (!current) return { ok: false, error: m.errors.notFound };

  const db = await createSupabaseServerClient();
  const { error: saveError } = await db.rpc("save_object_version", {
    p_object: object.id,
    p_type: object.type,
    p_kind: "restore",
    p_content: current.content,
    p_properties: current.properties,
    p_label: null,
  });
  if (saveError) {
    return {
      ok: false,
      error: saveError.message.includes("trash") ? m.errors.inTrash : m.errors.forbidden,
    };
  }

  const restorable = (properties: PropertySnapshot) =>
    Object.fromEntries(
      Object.entries(properties).filter(([key]) => adapter.restorableProperties.includes(key)),
    );

  try {
    if (request.scope === "all") {
      await adapter.writeContent(object, version.content);
      await adapter.writeProperties(object, restorable(version.properties));
    } else if (request.scope === "block") {
      await adapter.writeContent(object, restoreBlockInto(current.content, version.content, request.key));
    } else {
      if (!adapter.restorableProperties.includes(request.key) || !(request.key in version.properties)) {
        return { ok: false, error: m.errors.failed };
      }
      await adapter.writeProperties(object, { [request.key]: version.properties[request.key] });
    }
  } catch (writeError) {
    const message = (writeError as Error).message;
    return { ok: false, error: message === "not_found" ? m.errors.notFound : m.errors.restoreFailed };
  }
  revalidatePath("/collab", "layout");
  return { ok: true };
}
