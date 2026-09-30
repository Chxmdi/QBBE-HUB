import type { ObjectRecord, ObjectType, Uuid } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  OBJECT_COLUMNS,
  OBJECT_TYPE_COLUMNS,
  toObjectRecord,
  toObjectType,
  type ObjectRow,
  type ObjectTypeRow,
} from "./registry.mappers";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/**
 * Every live object type in the organization. RLS limits this to active
 * members of that organization.
 */
export async function listObjectTypes(
  organizationId: Uuid,
  client?: Client,
): Promise<ObjectType[]> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("object_type")
    .select(OBJECT_TYPE_COLUMNS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("kind")
    .order("key");
  if (error || !data) return [];
  return (data as ObjectTypeRow[]).map(toObjectType);
}

/**
 * One object, or null when it does not exist or the viewer cannot see it
 * (RLS asks public.can(id, 'view'); the two are deliberately indistinguishable).
 */
export async function getObject(id: Uuid, client?: Client): Promise<ObjectRecord | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("object")
    .select(OBJECT_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return toObjectRecord(data as ObjectRow);
}
