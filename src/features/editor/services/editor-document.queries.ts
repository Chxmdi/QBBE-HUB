import type { createSupabasePageClient } from "@/lib/supabase/page";
import { normalizeContent, type EditorContent } from "@/features/editor/adapter/content";

type PageClient = Awaited<ReturnType<typeof createSupabasePageClient>>;

export interface StoredEditorDocument {
  content: EditorContent;
  /** Null when nothing has been saved yet. */
  version: number | null;
}

/** An object's body, or empty content when none has been saved (RLS decides visibility). */
export async function loadEditorDocument(client: PageClient, objectId: string): Promise<StoredEditorDocument> {
  const { data } = await client
    .from("editor_document")
    .select("content, version")
    .eq("object_id", objectId)
    .maybeSingle();
  if (!data) return { content: normalizeContent(null), version: null };
  return { content: normalizeContent(data.content), version: data.version as number };
}
