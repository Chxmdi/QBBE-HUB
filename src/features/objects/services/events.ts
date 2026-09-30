import type { Identity, ObjectEventVerb, ObjectRef, PropertyChange, Uuid } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * One row of `object_event` as the application reads it. The contract's
 * `ObjectEvent` also carries a rendered `summary`; stored events do not, the
 * reader renders them (M9b). Contract addition, noted for integration.
 */
export interface StoredObjectEvent {
  id: Uuid;
  seq: number;
  object: ObjectRef;
  organizationId: Uuid;
  actor: Identity | { kind: "system"; id: null };
  verb: ObjectEventVerb;
  changes: StoredChange[];
  changeSetId: Uuid | null;
  occurredAt: string;
}

/** A property change, or a link change for linked/unlinked events. */
export type StoredChange =
  | PropertyChange
  | { relation: string; direction: "outgoing" | "incoming"; other: Uuid; otherType: string | null };

export interface ObjectEventRow {
  id: Uuid;
  seq: number | string;
  organization_id: Uuid;
  object_id: Uuid;
  object_type: string;
  actor_kind: "person" | "team" | "automation" | "integration" | "system";
  actor_id: string | null;
  verb: ObjectEventVerb;
  changes: unknown;
  change_set_id: Uuid | null;
  occurred_at: string;
}

export const OBJECT_EVENT_COLUMNS =
  "id, seq, organization_id, object_id, object_type, actor_kind, actor_id, verb, changes, change_set_id, occurred_at";

function toChange(raw: unknown): StoredChange | null {
  if (!raw || typeof raw !== "object") return null;
  const change = raw as Record<string, unknown>;
  if (typeof change.relation === "string") {
    return {
      relation: change.relation,
      direction: change.direction === "incoming" ? "incoming" : "outgoing",
      other: String(change.other ?? ""),
      otherType: typeof change.other_type === "string" ? change.other_type : null,
    };
  }
  if (typeof change.property !== "string") return null;
  return { property: change.property, before: change.before ?? null, after: change.after ?? null };
}

export function toStoredObjectEvent(row: ObjectEventRow): StoredObjectEvent {
  const actor =
    row.actor_kind === "system" || !row.actor_id
      ? ({ kind: "system", id: null } as const)
      : ({ kind: row.actor_kind, id: row.actor_id } as Identity);
  return {
    id: row.id,
    seq: Number(row.seq),
    object: { id: row.object_id, type: row.object_type },
    organizationId: row.organization_id,
    actor,
    verb: row.verb,
    changes: Array.isArray(row.changes)
      ? row.changes.map(toChange).filter((change): change is StoredChange => change !== null)
      : [],
    changeSetId: row.change_set_id,
    occurredAt: row.occurred_at,
  };
}

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/** An object's history, newest first. Events touching a private property the viewer can't see are absent. */
export async function listObjectEvents(
  objectId: Uuid,
  options: { limit?: number } = {},
  client?: Client,
): Promise<StoredObjectEvent[]> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .from("object_event")
    .select(OBJECT_EVENT_COLUMNS)
    .eq("object_id", objectId)
    .order("seq", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 200));
  if (error || !data) return [];
  return (data as ObjectEventRow[]).map(toStoredObjectEvent);
}
