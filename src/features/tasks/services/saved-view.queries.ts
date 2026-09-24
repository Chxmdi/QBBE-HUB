import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SavedView {
  id: string;
  name: string;
  path: string;
  query: Record<string, string>;
}

/**
 * The signed-in person's saved views for one screen (P1-UX-08). They were
 * written and deleted but never read, so a saved view could not be opened.
 * RLS (saved_view_own) limits this to the caller's own rows.
 */
export async function listSavedViews(path: string): Promise<SavedView[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("saved_view")
    .select("id, name, path, query")
    .eq("path", path)
    .order("created_at", { ascending: true });
  // A failed read must not look like "no saved views" (P0-UX-05).
  if (error) throw new Error(`Could not load saved views: ${error.message}`);
  return ((data ?? []) as SavedView[]).map((view) => ({
    ...view,
    query: Object.fromEntries(
      Object.entries(view.query ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  }));
}
