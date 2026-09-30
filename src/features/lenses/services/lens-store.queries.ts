import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LENS_KINDS, type LensKind, type SavedLens } from "./lens-store.types";

interface LensRowDb {
  id: string;
  name: string;
  kind: string;
  type_key: string | null;
  spec: Record<string, unknown>;
  layout: Record<string, unknown>;
  visibility: "personal" | "shared";
  path: string | null;
  legacy_query: Record<string, unknown> | null;
  unsupported_filters: string[];
  owner_id: string;
  source_saved_view_id: string | null;
  owner: { full_name: string } | null;
}

const SELECT =
  "id, name, kind, type_key, spec, layout, visibility, path, legacy_query, unsupported_filters, owner_id, source_saved_view_id, owner:owner_id(full_name)";

function toLens(row: LensRowDb, viewerId: string): SavedLens {
  return {
    id: row.id,
    name: row.name,
    kind: (LENS_KINDS as readonly string[]).includes(row.kind) ? (row.kind as LensKind) : "table",
    typeKey: row.type_key,
    spec: row.spec ?? {},
    layout: row.layout ?? {},
    visibility: row.visibility,
    path: row.path,
    legacyQuery: row.legacy_query
      ? Object.fromEntries(Object.entries(row.legacy_query).filter((e): e is [string, string] => typeof e[1] === "string"))
      : null,
    unsupportedFilters: row.unsupported_filters ?? [],
    ownerId: row.owner_id,
    ownerName: row.owner?.full_name ?? null,
    mine: row.owner_id === viewerId,
    fromSavedView: row.source_saved_view_id !== null,
  };
}

/**
 * The viewer's own lenses and the ones shared in their organization (RLS
 * decides which). A failed read throws, so it never looks like "no lenses".
 */
export async function listLenses(viewerId: string, filter: { path?: string } = {}): Promise<SavedLens[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("lens").select(SELECT).order("name");
  if (filter.path) query = query.eq("path", filter.path);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load lenses: ${error.message}`);
  return ((data ?? []) as unknown as LensRowDb[]).map((row) => toLens(row, viewerId));
}

export async function getLens(viewerId: string, id: string): Promise<SavedLens | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("lens").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the lens: ${error.message}`);
  return data ? toLens(data as unknown as LensRowDb, viewerId) : null;
}
