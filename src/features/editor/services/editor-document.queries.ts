import type { createSupabasePageClient } from "@/lib/supabase/page";
import { normalizeContent, type EditorContent } from "@/features/editor/adapter/content";
import { byteaHexToBase64 } from "@/features/editor/adapter/state";

type PageClient = Awaited<ReturnType<typeof createSupabasePageClient>>;

export interface StoredEditorDocument {
  content: EditorContent;
  /** The editor's Yjs state as base64, when one has been saved (M4c). */
  state: string | null;
  /** Null when nothing has been saved yet. */
  version: number | null;
}

/** An object's body, or empty content when none has been saved (RLS decides visibility). */
export async function loadEditorDocument(client: PageClient, objectId: string): Promise<StoredEditorDocument> {
  const { data } = await client
    .from("editor_document")
    .select("content, version, yjs_state")
    .eq("object_id", objectId)
    .maybeSingle();
  if (!data) return { content: normalizeContent(null), state: null, version: null };
  return {
    content: normalizeContent(data.content),
    state: byteaHexToBase64(data.yjs_state as string | null),
    version: data.version as number,
  };
}
