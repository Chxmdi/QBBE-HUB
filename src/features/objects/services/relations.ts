import type { ObjectRef, Relation, Uuid } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where a relation row came from. Extends `Relation["source"]` in contracts.ts
 * with `native_column`: links read from a record's own column other than
 * task.project_id (decision.meeting_id, a risk's project_id and so on).
 * Contract addition, noted for integration.
 */
export type RelationSource = Relation["source"] | "native_column";

export interface ObjectRelation extends Omit<Relation, "source"> {
  source: RelationSource;
}

/** A row of the `object_relation_all` view. */
export interface ObjectRelationRow {
  id: Uuid | null;
  relation_type_key: string;
  from_id: Uuid;
  from_type: string;
  to_id: Uuid;
  to_type: string;
  source: RelationSource;
}

export const OBJECT_RELATION_COLUMNS = "id, relation_type_key, from_id, from_type, to_id, to_type, source";

export function toObjectRelation(row: ObjectRelationRow): ObjectRelation {
  return {
    id: row.id,
    relationTypeKey: row.relation_type_key,
    from: { id: row.from_id, type: row.from_type },
    to: { id: row.to_id, type: row.to_type },
    source: row.source,
  };
}

/** One link seen from a given object: which way it points and what is at the other end. */
export interface RelationFromObject {
  relation: ObjectRelation;
  direction: "outgoing" | "incoming";
  other: ObjectRef;
}

export function orientRelations(objectId: Uuid, relations: ObjectRelation[]): RelationFromObject[] {
  const seen = new Set<string>();
  const oriented: RelationFromObject[] = [];
  for (const relation of relations) {
    const outgoing = relation.from.id === objectId;
    if (!outgoing && relation.to.id !== objectId) continue;
    // task.blocked_by_id and task_dependency can describe the same link once.
    const key = `${relation.relationTypeKey}:${relation.from.id}:${relation.to.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    oriented.push({
      relation,
      direction: outgoing ? "outgoing" : "incoming",
      other: outgoing ? relation.to : relation.from,
    });
  }
  return oriented;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/**
 * Every link to or from an object that the viewer may see. Each branch of the
 * view is filtered by its own table's RLS.
 */
export async function listRelations(objectId: Uuid, client?: Client): Promise<RelationFromObject[]> {
  // The id is interpolated into a PostgREST filter, so it must be a bare uuid.
  if (!UUID.test(objectId)) return [];
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("object_relation_all")
    .select(OBJECT_RELATION_COLUMNS)
    .or(`from_id.eq.${objectId},to_id.eq.${objectId}`)
    .limit(500);
  if (error || !data) return [];
  return orientRelations(objectId, (data as ObjectRelationRow[]).map(toObjectRelation));
}
