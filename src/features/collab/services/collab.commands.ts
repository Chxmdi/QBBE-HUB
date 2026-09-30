"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isCursor, type PresenceCursor, type PresenceEntry } from "../presence";

const objectId = z.string().uuid();

/** "I am here", with my cursor. Quietly false when refused or offline. */
export async function touchPresence(
  id: unknown,
  cursor: PresenceCursor | null,
  editing: boolean,
): Promise<boolean> {
  await requireSession();
  const parsed = objectId.safeParse(id);
  if (!parsed.success || (cursor !== null && !isCursor(cursor))) return false;
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("touch_presence", {
    p_object: parsed.data,
    p_cursor: cursor,
    p_editing: editing === true,
  });
  return !error;
}

export async function leavePresence(id: unknown): Promise<void> {
  await requireSession();
  const parsed = objectId.safeParse(id);
  if (!parsed.success) return;
  const db = await createSupabaseServerClient();
  await db.rpc("leave_presence", { p_object: parsed.data });
}

/** Everyone present on the object, as the reader may see them (RLS). */
export async function listPresence(id: unknown): Promise<PresenceEntry[]> {
  await requireSession();
  const parsed = objectId.safeParse(id);
  if (!parsed.success) return [];
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_presence")
    .select("user_id, editing, cursor, updated_at, user_profile:user_id(full_name)")
    .eq("object_id", parsed.data)
    .limit(100);
  return ((data ?? []) as unknown as {
    user_id: string;
    editing: boolean;
    cursor: unknown;
    updated_at: string;
    user_profile: { full_name: string } | null;
  }[]).map((row) => ({
    userId: row.user_id,
    name: row.user_profile?.full_name ?? "",
    editing: row.editing,
    cursor: isCursor(row.cursor) ? row.cursor : null,
    updatedAt: row.updated_at,
  }));
}

export interface LockResult {
  ok: boolean;
}

export async function setObjectLock(id: unknown, locked: boolean, reason?: string): Promise<LockResult> {
  await requireSession();
  const parsed = objectId.safeParse(id);
  const why = z.string().trim().max(300).optional().safeParse(reason);
  if (!parsed.success || !why.success) return { ok: false };
  const db = await createSupabaseServerClient();
  const { error } = locked
    ? await db.rpc("lock_object", { p_object: parsed.data, p_reason: why.data || null })
    : await db.rpc("unlock_object", { p_object: parsed.data });
  if (error) return { ok: false };
  revalidatePath("/collab", "layout");
  return { ok: true };
}
