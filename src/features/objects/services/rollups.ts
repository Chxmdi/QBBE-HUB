import type { RelationCardinality, Uuid } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "rpc">;

export const rollupFunctions = ["count", "sum", "average", "min", "max"] as const;
export type RollupFunction = (typeof rollupFunctions)[number];

/** `options` of a relation property (V1-7). */
export interface RelationPropertyOptions {
  relationTypeKey: string;
  direction: "outgoing" | "incoming";
  targetTypeKey: string;
  /** The property on the other side of a two-way relation. */
  pairedKey?: string;
}

/** `options` of a rollup property (V1-7). */
export interface RollupPropertyOptions {
  relationProperty: string;
  targetProperty: string | null;
  function: RollupFunction;
}

export function parseRelationOptions(options: Record<string, unknown>): RelationPropertyOptions | null {
  const { relationTypeKey, direction, targetTypeKey, pairedKey } = options;
  if (typeof relationTypeKey !== "string" || typeof targetTypeKey !== "string") return null;
  if (direction !== "outgoing" && direction !== "incoming") return null;
  return { relationTypeKey, direction, targetTypeKey, ...(typeof pairedKey === "string" ? { pairedKey } : {}) };
}

export function parseRollupOptions(options: Record<string, unknown>): RollupPropertyOptions | null {
  const fn = options.function;
  if (typeof options.relationProperty !== "string") return null;
  if (typeof fn !== "string" || !(rollupFunctions as readonly string[]).includes(fn)) return null;
  const target = typeof options.targetProperty === "string" ? options.targetProperty : null;
  if (fn !== "count" && !target) return null;
  return { relationProperty: options.relationProperty, targetProperty: target, function: fn as RollupFunction };
}

const KEY = /^[a-z][a-z0-9_]{0,62}$/;

/** Owners and admins: a relation with a property on each side. Returns the relation type id. */
export async function createTwoWayRelation(
  client: Client,
  input: {
    fromTypeId: Uuid;
    toTypeId: Uuid;
    key: string;
    name: { en: string; fr: string };
    reverseKey: string;
    reverseName: { en: string; fr: string };
    cardinality: RelationCardinality;
  },
): Promise<{ ok: true; relationTypeId: Uuid } | { ok: false; message: string }> {
  if (!KEY.test(input.key) || !KEY.test(input.reverseKey)) return { ok: false, message: "invalid_key" };
  const { data, error } = await client.rpc("create_two_way_relation", {
    p_from_type: input.fromTypeId,
    p_to_type: input.toTypeId,
    p_key: input.key,
    p_name_en: input.name.en,
    p_name_fr: input.name.fr,
    p_reverse_key: input.reverseKey,
    p_reverse_name_en: input.reverseName.en,
    p_reverse_name_fr: input.reverseName.fr,
    p_cardinality: input.cardinality,
  });
  return error || !data ? { ok: false, message: error?.message ?? "failed" } : { ok: true, relationTypeId: data as Uuid };
}

/** Owners and admins: a stored rollup over a relation property. */
export async function createRollupProperty(
  client: Client,
  input: { typeId: Uuid; key: string; name: { en: string; fr: string } } & RollupPropertyOptions,
): Promise<{ ok: true; propertyId: Uuid } | { ok: false; message: string }> {
  if (!KEY.test(input.key) || !parseRollupOptions({ ...input })) return { ok: false, message: "invalid_rollup" };
  const { data, error } = await client.rpc("create_rollup_property", {
    p_type: input.typeId,
    p_key: input.key,
    p_name_en: input.name.en,
    p_name_fr: input.name.fr,
    p_relation_property: input.relationProperty,
    p_target_property: input.targetProperty,
    p_function: input.function,
  });
  return error || !data ? { ok: false, message: error?.message ?? "failed" } : { ok: true, propertyId: data as Uuid };
}
