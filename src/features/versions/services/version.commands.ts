"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { contentAdapterFor } from "../adapters/registry";
import { isContentSnapshot } from "../content";
import { versionsText, type VersionsText } from "../messages";
import { objectRefSchema } from "../schema";

export interface VersionActionResult {
  ok: boolean;
  error?: string;
  id?: string | null;
}

/** The database's refusals, in the reader's language. */
function translate(message: string | undefined, m: VersionsText): string {
  if (!message) return m.errors.failed;
  if (message.includes("legal hold")) return m.errors.held;
  if (message.includes("already in the trash")) return m.errors.alreadyInTrash;
  if (message.includes("not in the trash")) return m.errors.notInTrash;
  if (message.includes("from the trash before")) return m.errors.inTrash;
  if (message === "not_found") return m.errors.notFound;
  if (message.includes("cannot") || message.includes("row-level security") || message.includes("Only the")) {
    return m.errors.forbidden;
  }
  return m.errors.failed;
}

const saveSchema = z.object({
  object: objectRefSchema,
  label: z.string().trim().max(120).optional(),
});

/** Saves a named version of the object as it is now. */
export async function saveNamedVersion(input: unknown): Promise<VersionActionResult> {
  await requireSession();
  const m = versionsText(await getLocale());
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.failed };
  const { object, label } = parsed.data;
  const adapter = contentAdapterFor(object.type);
  if (!adapter) return { ok: false, error: m.errors.unsupported };
  const snapshot = await adapter.read(object);
  if (!snapshot) return { ok: false, error: m.errors.notFound };
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("save_object_version", {
    p_object: object.id,
    p_type: object.type,
    p_kind: "manual",
    p_content: snapshot.content,
    p_properties: snapshot.properties,
    p_label: label || null,
  });
  if (error) return { ok: false, error: translate(error.message, m) };
  revalidatePath("/collab", "layout");
  return { ok: true, id: data as string };
}

const autosaveSchema = z.object({
  object: objectRefSchema,
  content: z.unknown().refine(isContentSnapshot),
});

/**
 * Autosave: writes the content through the type's adapter, then asks the
 * database for an automatic snapshot, which it takes at most every 10
 * minutes and only when something changed.
 */
export async function autosaveObjectContent(input: unknown): Promise<VersionActionResult> {
  await requireSession();
  const m = versionsText(await getLocale());
  const parsed = autosaveSchema.safeParse(input);
  if (!parsed.success || !isContentSnapshot(parsed.data.content)) {
    return { ok: false, error: m.errors.failed };
  }
  const { object, content } = parsed.data;
  const adapter = contentAdapterFor(object.type);
  if (!adapter) return { ok: false, error: m.errors.unsupported };
  try {
    await adapter.writeContent(object, content);
  } catch (writeError) {
    return { ok: false, error: translate((writeError as Error).message, m) };
  }
  const snapshot = await adapter.read(object);
  if (!snapshot) return { ok: false, error: m.errors.notFound };
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("save_object_version", {
    p_object: object.id,
    p_type: object.type,
    p_kind: "auto",
    p_content: snapshot.content,
    p_properties: snapshot.properties,
    p_label: null,
  });
  // The content itself is saved; a refused snapshot is not the editor's problem.
  if (error) console.error("automatic snapshot failed", error.message);
  return { ok: true, id: (data as string | null) ?? null };
}

/** Moves an object to the trash for 30 days. */
export async function trashObject(input: unknown): Promise<VersionActionResult> {
  await requireSession();
  const m = versionsText(await getLocale());
  const parsed = objectRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.failed };
  const object = parsed.data;
  const adapter = contentAdapterFor(object.type);
  const title = (await adapter?.title(object)) ?? "";
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("trash_object", {
    p_object: object.id,
    p_type: object.type,
    p_title: title,
  });
  if (error) return { ok: false, error: translate(error.message, m) };
  revalidatePath("/collab", "layout");
  return { ok: true, id: data as string };
}

/** Takes an object out of the trash. */
export async function restoreObject(objectId: unknown): Promise<VersionActionResult> {
  await requireSession();
  const m = versionsText(await getLocale());
  const id = z.string().uuid().safeParse(objectId);
  if (!id.success) return { ok: false, error: m.errors.notInTrash };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("restore_object", { p_object: id.data });
  if (error) return { ok: false, error: translate(error.message, m) };
  revalidatePath("/collab", "layout");
  return { ok: true, id: id.data };
}
