import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SuggestionView {
  id: string;
  blockId: string;
  originalText: string;
  proposedText: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
}

/** Open suggestions on an object, oldest first, as the reader may see them. */
export async function listOpenSuggestions(objectId: string): Promise<SuggestionView[]> {
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("object_suggestion")
    .select("id, block_id, original_text, proposed_text, author_id, created_at, user_profile:author_id(full_name)")
    .eq("object_id", objectId)
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(200);
  return ((data ?? []) as unknown as {
    id: string;
    block_id: string;
    original_text: string;
    proposed_text: string;
    author_id: string;
    created_at: string;
    user_profile: { full_name: string } | null;
  }[]).map((row) => ({
    id: row.id,
    blockId: row.block_id,
    originalText: row.original_text,
    proposedText: row.proposed_text,
    authorId: row.author_id,
    authorName: row.user_profile?.full_name ?? null,
    createdAt: row.created_at,
  }));
}
