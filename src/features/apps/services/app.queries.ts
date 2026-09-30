import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Uuid } from "@/lib/objects/contracts";
import type { AppCapability } from "../schema";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from" | "rpc">;

export interface AppRow {
  id: Uuid;
  organizationId: Uuid;
  slug: string;
  nameEn: string;
  nameFr: string;
  descriptionEn: string;
  descriptionFr: string;
  definition: unknown;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface RoleGrant {
  role: string;
  capabilities: AppCapability[];
}

const columns =
  "id, organization_id, slug, name_en, name_fr, description_en, description_fr, definition, published_at, archived_at";

type Raw = {
  id: string;
  organization_id: string;
  slug: string;
  name_en: string;
  name_fr: string;
  description_en: string;
  description_fr: string;
  definition: unknown;
  published_at: string | null;
  archived_at: string | null;
};

function toRow(raw: Raw): AppRow {
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    slug: raw.slug,
    nameEn: raw.name_en,
    nameFr: raw.name_fr,
    descriptionEn: raw.description_en,
    descriptionFr: raw.description_fr,
    definition: raw.definition,
    publishedAt: raw.published_at,
    archivedAt: raw.archived_at,
  };
}

/** Apps the caller may open: RLS returns drafts to admins and granted, published apps to others. */
export async function listApps(client: Client, organizationId: Uuid): Promise<AppRow[]> {
  const { data, error } = await client
    .from("workspace_app")
    .select(columns)
    .eq("organization_id", organizationId)
    .order("name_en");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Raw[]).map(toRow);
}

export async function getApp(
  client: Client,
  organizationId: Uuid,
  by: { slug: string } | { id: Uuid },
): Promise<AppRow | null> {
  let query = client.from("workspace_app").select(columns).eq("organization_id", organizationId);
  query = "slug" in by ? query.eq("slug", by.slug) : query.eq("id", by.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRow(data as Raw) : null;
}

/** Role grants, for the permissions table. Admin-only by RLS; others read only their own person grant. */
export async function listRoleGrants(client: Client, appId: Uuid): Promise<RoleGrant[]> {
  const { data, error } = await client
    .from("workspace_app_grant")
    .select("org_role, capabilities")
    .eq("app_id", appId)
    .not("org_role", "is", null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { org_role: string; capabilities: AppCapability[] }[]).map((g) => ({
    role: g.org_role,
    capabilities: g.capabilities,
  }));
}

export async function canUseApp(client: Client, appId: Uuid, capability: AppCapability | string): Promise<boolean> {
  const { data, error } = await client.rpc("can_use_app", { p_app: appId, p_capability: capability });
  return !error && data === true;
}
