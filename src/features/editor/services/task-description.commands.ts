"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeContent, plainTextToContent, type EditorContent } from "@/features/editor/adapter/content";
import { byteaHexToBase64 } from "@/features/editor/adapter/state";

/**
 * A task's description as an editor document (M4d). When the task has no
 * document yet, its plain-text description is converted on read, with the
 * same rules as the migration (app.plain_text_to_content). Editing follows
 * app.can(task, 'edit_content'), the same capability that may change the
 * description today.
 */

export type TaskDescriptionBody =
  | { enabled: false }
  | {
      enabled: true;
      content: EditorContent;
      state: string | null;
      version: number | null;
      editable: boolean;
    };

export async function loadTaskDescription(taskId: unknown): Promise<TaskDescriptionBody> {
  const parsed = z.string().uuid().safeParse(taskId);
  if (!parsed.success || !(await isEnabled("wos_editor"))) return { enabled: false };
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const [document, task, can] = await Promise.all([
    supabase.from("editor_document").select("content, version, yjs_state").eq("object_id", parsed.data).maybeSingle(),
    supabase.from("task").select("description").eq("id", parsed.data).maybeSingle(),
    supabase.rpc("can", { object_id: parsed.data, capability: "edit_content" }),
  ]);
  // A read error is not "no description": fall back to the plain form.
  if (document.error || task.error || !task.data) return { enabled: false };
  const editable = can.data === true;
  if (!document.data) {
    return {
      enabled: true,
      content: plainTextToContent(task.data.description as string | null),
      state: null,
      version: null,
      editable,
    };
  }
  return {
    enabled: true,
    content: normalizeContent(document.data.content),
    state: byteaHexToBase64(document.data.yjs_state as string | null),
    version: document.data.version as number,
    editable,
  };
}
