import type { Change, ChangeSet, Identity, Uuid } from "@/lib/objects/contracts";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ChangeSetStore } from "./registry";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from" | "rpc">;

interface ChangeSetRow {
  id: Uuid;
  action_key: string;
  actor_kind: Identity["kind"] | "system";
  actor_id: string | null;
  created_at: string;
  undo_of: Uuid | null;
  undone_at: string | null;
}

interface ChangeSetItemRow {
  position: number;
  kind: Change["kind"];
  object_id: Uuid;
  object_type: string;
  property: string | null;
  before: unknown;
  after: unknown;
  relation_type_key: string | null;
  to_id: Uuid | null;
  to_type: string | null;
}

export function toChange(item: ChangeSetItemRow): Change {
  const object = { id: item.object_id, type: item.object_type };
  switch (item.kind) {
    case "update":
      return { kind: "update", object, property: item.property ?? "", before: item.before, after: item.after };
    case "create":
      return { kind: "create", object, values: (item.after as Record<string, unknown>) ?? {} };
    case "delete":
      return { kind: "delete", object, values: (item.before as Record<string, unknown>) ?? {} };
    default:
      return {
        kind: item.kind,
        relation: {
          relationTypeKey: item.relation_type_key ?? "",
          from: object,
          to: { id: item.to_id ?? "", type: item.to_type ?? "" },
        },
      };
  }
}

function toActor(row: ChangeSetRow): Identity {
  if (row.actor_kind === "system" || !row.actor_id) return { kind: "integration", id: "system" };
  return { kind: row.actor_kind, id: row.actor_id } as Identity;
}

/** Change sets in the database, written through public.record_change_set. */
export function createSupabaseChangeSetStore(client: Client): ChangeSetStore {
  return {
    async begin() {
      const { data, error } = await client.rpc("object_event_high_water");
      return error || data === null || data === undefined ? null : Number(data);
    },
    async save({ actionKey, changes, context, marker, undoOf }) {
      const { data, error } = await client.rpc("record_change_set", {
        p_action_key: actionKey,
        p_changes: changes,
        p_since_seq: marker,
        p_undo_of: undoOf,
      });
      if (error || !data) throw new Error(error?.message ?? "The change set could not be recorded.");
      const row = data as ChangeSetRow;
      return {
        id: row.id,
        actionKey,
        actor: context.actor,
        createdAt: row.created_at,
        changes,
        undoOf,
      } satisfies ChangeSet;
    },
    async load(id) {
      const { data: row, error } = await client
        .from("change_set")
        .select("id, action_key, actor_kind, actor_id, created_at, undo_of, undone_at")
        .eq("id", id)
        .maybeSingle();
      if (error || !row) return null;
      const { data: items, error: itemsError } = await client
        .from("change_set_item")
        .select("position, kind, object_id, object_type, property, before, after, relation_type_key, to_id, to_type")
        .eq("change_set_id", id)
        .order("position");
      if (itemsError || !items) return null;
      const set = row as ChangeSetRow;
      return {
        id: set.id,
        actionKey: set.action_key,
        actor: toActor(set),
        createdAt: set.created_at,
        changes: (items as ChangeSetItemRow[]).map(toChange),
        undoOf: set.undo_of,
        undoneAt: set.undone_at,
      };
    },
  };
}
