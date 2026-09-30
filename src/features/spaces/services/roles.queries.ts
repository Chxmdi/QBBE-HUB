import { createSupabaseServerClient } from "@/lib/supabase/server";
import { capabilitiesFromBits, sharingRoleKeys, type AccessRole } from "./roles";

interface RoleRow {
  id: string;
  key: string;
  name_en: string;
  name_fr: string;
  caps: number;
  builtin: boolean;
}

/**
 * The roles offered when sharing: the four built-in sharing roles, then the
 * organization's custom roles. Built-in roles that restate today's record
 * rules (manager, contributor, ...) are not offered: they come from today's
 * tables.
 */
export async function listSharingRoles(withUsage: boolean): Promise<AccessRole[]> {
  const db = await createSupabaseServerClient();
  const [{ data, error }, usage] = await Promise.all([
    db.from("access_role").select("id, key, name_en, name_fr, caps, builtin").order("name_en"),
    withUsage ? db.rpc("access_role_usage") : Promise.resolve({ data: [], error: null }),
  ]);
  if (error) throw new Error(`Could not read roles: ${error.message}`);
  const uses = new Map(
    ((usage.data ?? []) as { role_id: string; grants: number }[]).map((row) => [row.role_id, Number(row.grants)]),
  );
  const rows = (data ?? []) as RoleRow[];
  const builtin = sharingRoleKeys
    .map((key) => rows.find((row) => row.builtin && row.key === key))
    .filter((row): row is RoleRow => Boolean(row));
  const custom = rows.filter((row) => !row.builtin);
  return [...builtin, ...custom].map((row) => ({
    id: row.id,
    key: row.key,
    name: { en: row.name_en, fr: row.name_fr },
    capabilities: capabilitiesFromBits(row.caps),
    builtin: row.builtin,
    uses: row.builtin ? null : withUsage ? (uses.get(row.id) ?? 0) : null,
  }));
}
