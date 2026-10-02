import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contentAdapterFor, type EditorDocumentType } from "@/features/versions/adapters/registry";

/** The database takes an automatic snapshot at most this often (save_object_version). */
const AUTO_VERSION_MINUTES = 10;

/**
 * Asks the database for an automatic snapshot of a page or meeting after a
 * save (U9, plan A10). The database takes one at most every ten minutes and
 * only when something changed; while the last version is that recent the
 * snapshot is not even built, so typing costs one small read per save. The
 * content itself is already saved, so a refused or failed snapshot is logged
 * and never fails the save. Both save paths call it; it lives outside their
 * "use server" modules so it is never an action of its own.
 */
export async function recordAutomaticVersion(objectId: string, objectType: EditorDocumentType): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: last } = await supabase
      .from("object_version")
      .select("created_at")
      .eq("object_id", objectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = (last as { created_at?: string } | null)?.created_at;
    if (lastAt && Date.now() - new Date(lastAt).getTime() < AUTO_VERSION_MINUTES * 60_000) return;
    const object = { id: objectId, type: objectType };
    const snapshot = await contentAdapterFor(objectType)?.read(object);
    if (!snapshot) return;
    const { error } = await supabase.rpc("save_object_version", {
      p_object: objectId,
      p_type: objectType,
      p_kind: "auto",
      p_content: snapshot.content,
      p_properties: snapshot.properties,
      p_label: null,
    });
    if (error) console.error("automatic snapshot failed", error.message);
  } catch (error) {
    console.error("automatic snapshot failed", (error as Error).message);
  }
}
