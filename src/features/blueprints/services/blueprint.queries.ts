import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Uuid } from "@/lib/objects/contracts";
import type { ExistingKeys } from "../plan";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

export type BlueprintStatus = "draft" | "approved" | "built";

export interface BlueprintRow {
  id: Uuid;
  organizationId: Uuid;
  key: string;
  nameEn: string;
  nameFr: string;
  definition: unknown;
  status: BlueprintStatus;
  approvedAt: string | null;
  updatedAt: string;
}

export interface BlueprintBuildRow {
  changeSetId: Uuid;
  builtAt: string;
  undoneAt: string | null;
  counts: Record<string, number>;
}

const columns = "id, organization_id, key, name_en, name_fr, definition, status, approved_at, updated_at";

type RawBlueprint = {
  id: string;
  organization_id: string;
  key: string;
  name_en: string;
  name_fr: string;
  definition: unknown;
  status: BlueprintStatus;
  approved_at: string | null;
  updated_at: string;
};

function toRow(raw: RawBlueprint): BlueprintRow {
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    key: raw.key,
    nameEn: raw.name_en,
    nameFr: raw.name_fr,
    definition: raw.definition,
    status: raw.status,
    approvedAt: raw.approved_at,
    updatedAt: raw.updated_at,
  };
}

/** Blueprints the caller can read (RLS: staff and up in their organization). */
export async function listBlueprints(client: Client, organizationId: Uuid): Promise<BlueprintRow[]> {
  const { data } = await client
    .from("blueprint")
    .select(columns)
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  return ((data ?? []) as RawBlueprint[]).map(toRow);
}

export async function getBlueprint(client: Client, id: Uuid): Promise<BlueprintRow | null> {
  const { data } = await client.from("blueprint").select(columns).eq("id", id).maybeSingle();
  return data ? toRow(data as RawBlueprint) : null;
}

/** The blueprint's live build, if it has one. */
export async function liveBuild(client: Client, blueprintId: Uuid): Promise<BlueprintBuildRow | null> {
  const { data } = await client
    .from("blueprint_build")
    .select("change_set_id, built_at, undone_at, counts")
    .eq("blueprint_id", blueprintId)
    .is("undone_at", null)
    .maybeSingle();
  if (!data) return null;
  return {
    changeSetId: data.change_set_id,
    builtAt: data.built_at,
    undoneAt: data.undone_at,
    counts: (data.counts ?? {}) as Record<string, number>,
  };
}

/**
 * Type and relation keys created by other live builds in the organization.
 * Stand-in for reading object_type and relation_type once S1 lands.
 */
export async function existingKeys(
  client: Client,
  organizationId: Uuid,
  exceptBlueprintId: Uuid,
): Promise<ExistingKeys> {
  const { data } = await client
    .from("blueprint_build")
    .select("blueprint_id, changes")
    .eq("organization_id", organizationId)
    .is("undone_at", null);
  const types: string[] = [];
  const relations: string[] = [];
  for (const build of (data ?? []) as { blueprint_id: string; changes: unknown }[]) {
    if (build.blueprint_id === exceptBlueprintId || !Array.isArray(build.changes)) continue;
    for (const change of build.changes as { object?: { type?: string }; values?: { key?: string } }[]) {
      const key = change.values?.key;
      if (!key) continue;
      if (change.object?.type === "object_type") types.push(key);
      if (change.object?.type === "relation_type") relations.push(key);
    }
  }
  return { types, relations };
}
