import { createRollupProperty, type RollupFunction } from "@/features/objects/services/rollups";
import type { Change, Uuid } from "@/lib/objects/contracts";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Blueprint } from "../schema";
import { planBlueprint } from "../plan";

/**
 * Applies a blueprint's plan to the workspace's real structure tables, as the
 * signed-in person and only through what the database already allows:
 *
 * - `object_type` and `relation_type` rows are inserted directly (owners and
 *   admins may, under row-level security);
 * - plain and formula properties are inserted into `property_definition`
 *   (a formula's expression travels in `options.expression`, V1-8);
 * - relation properties go through `create_native_relation_property` and
 *   rollups through `create_rollup_property` (V1-7), the two definer
 *   functions that may create those kinds.
 *
 * Nothing new is added to the database: no migration, no function. Rows are
 * applied in the plan's order, so a rollup always finds its relation
 * property and target, and each row is idempotent by key: a type, relation
 * or property that already exists is reused and left alone, one that exists
 * archived is restored. What the build created or restored is written into
 * each change's `values.applied`, and the change list is what
 * `blueprint_build` records, so undo knows exactly what to remove.
 *
 * There is no transaction across these calls, so a failure part-way archives
 * what this build had created so far (in reverse order) before reporting.
 */

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export type BuildClient = Pick<Supabase, "from" | "rpc">;

/** How one planned row was applied. */
export type Applied = "created" | "restored" | "existing" | "recorded";

/** Tables whose rows a build touches and undo archives. */
const archivable = ["object_type", "relation_type", "property_definition"] as const;
type Archivable = (typeof archivable)[number];

export type BuildFailure =
  | { code: "database"; error: { code?: string; message?: string } }
  | { code: "propertyKindClash"; key: string }
  /** A property with this key exists on the type but is set up differently (another relation, formula or rollup). */
  | { code: "propertyClash"; key: string }
  | { code: "typeNotCustom"; key: string }
  /** A relation with this key exists but connects other types, or is native. */
  | { code: "relationClash"; key: string };

export type ApplyResult =
  | { ok: true; changeSetId: Uuid; changes: Change[]; count: number }
  | { ok: false; failure: BuildFailure; rolledBack: boolean };

interface ExistingRow {
  id: string;
  key: string;
  archived_at: string | null;
}
interface ExistingType extends ExistingRow {
  kind: string;
}
interface ExistingRelation extends ExistingRow {
  from_type_id: string | null;
  to_type_id: string | null;
  is_native: boolean;
}
interface ExistingProperty extends ExistingRow {
  type_id: string;
  kind: string;
  options: Values | null;
  visible_to_roles: string[] | null;
}

/** The settings that make two relation, formula or rollup properties the same property. */
function identity(kind: unknown, options: Values | null | undefined): string {
  const o = options ?? {};
  if (kind === "relation") return JSON.stringify([o.relationTypeKey, o.direction, o.targetTypeKey]);
  if (kind === "formula") return JSON.stringify([o.expression]);
  if (kind === "rollup") return JSON.stringify([o.relationProperty, o.targetProperty ?? null, o.function]);
  return "";
}

type Values = Record<string, unknown>;
type DbError = { code?: string; message?: string };
type Outcome<T> = { ok: true; value: T } | { ok: false; error: DbError };

async function selectId(query: PromiseLike<{ data: unknown; error: DbError | null }>): Promise<Outcome<string>> {
  const { data, error } = await query;
  const id = (data as { id?: string } | null)?.id;
  if (error) return { ok: false, error };
  if (!id) return { ok: false, error: { code: "42501", message: "Row-level security refused the write." } };
  return { ok: true, value: id };
}

/** Marks rows undone (archived) in reverse order; returns the first failure. */
export async function archiveRows(
  client: BuildClient,
  rows: { table: Archivable; id: string }[],
): Promise<DbError | null> {
  for (const row of [...rows].reverse()) {
    const result = await selectId(
      client.from(row.table).update({ archived_at: new Date().toISOString() }).eq("id", row.id).select("id").maybeSingle(),
    );
    if (!result.ok) return result.error;
  }
  return null;
}

/** Rows a build created or restored, from a recorded change list, in build order. */
export function rowsToUndo(changes: unknown): { table: Archivable; id: string }[] {
  if (!Array.isArray(changes)) return [];
  const rows: { table: Archivable; id: string }[] = [];
  for (const change of changes as { object?: { id?: string; type?: string }; values?: { applied?: string } }[]) {
    const table = change.object?.type;
    const id = change.object?.id;
    const applied = change.values?.applied;
    if (!id || !table || !(archivable as readonly string[]).includes(table)) continue;
    if (applied === "created" || applied === "restored") rows.push({ table: table as Archivable, id });
  }
  return rows;
}

export async function applyBlueprintBuild(
  client: BuildClient,
  input: { blueprintId: Uuid; organizationId: Uuid; blueprint: Blueprint },
): Promise<ApplyResult> {
  const { blueprintId, organizationId, blueprint } = input;
  const plan = planBlueprint(blueprint);
  const planned = plan.changes.filter((c): c is Extract<Change, { kind: "create" }> => c.kind === "create");

  // What the workspace already has, read once.
  const typeKeys = blueprint.types.map((t) => t.key);
  const relationKeys = blueprint.relations.map((r) => r.key);
  const types = await client
    .from("object_type")
    .select("id, key, kind, archived_at")
    .eq("organization_id", organizationId)
    .in("key", typeKeys);
  if (types.error) return { ok: false, failure: { code: "database", error: types.error }, rolledBack: true };
  const relations = relationKeys.length
    ? await client
        .from("relation_type")
        .select("id, key, archived_at, from_type_id, to_type_id, is_native")
        .eq("organization_id", organizationId)
        .in("key", relationKeys)
    : { data: [], error: null };
  if (relations.error) return { ok: false, failure: { code: "database", error: relations.error }, rolledBack: true };
  const existingTypes = new Map(((types.data ?? []) as ExistingType[]).map((row) => [row.key, row]));
  const existingRelations = new Map(((relations.data ?? []) as ExistingRelation[]).map((row) => [row.key, row]));
  const existingTypeIds = [...existingTypes.values()].map((row) => row.id);
  const properties = existingTypeIds.length
    ? await client.from("property_definition").select("id, type_id, key, kind, options, visible_to_roles, archived_at").in("type_id", existingTypeIds)
    : { data: [], error: null };
  if (properties.error) return { ok: false, failure: { code: "database", error: properties.error }, rolledBack: true };
  const existingProperties = new Map(
    ((properties.data ?? []) as ExistingProperty[]).map((row) => [`${row.type_id}/${row.key}`, row]),
  );

  for (const type of blueprint.types) {
    const existing = existingTypes.get(type.key);
    if (existing && existing.kind !== "custom") {
      return { ok: false, failure: { code: "typeNotCustom", key: type.key }, rolledBack: true };
    }
  }

  const realIds = new Map<string, string>(); // plan id -> database id
  const typeIdByKey = new Map<string, string>(); // type key -> database id
  const touched: { table: Archivable; id: string }[] = [];
  const changes: Change[] = [];

  const fail = async (failure: BuildFailure): Promise<ApplyResult> => {
    const error = await archiveRows(client, touched);
    return { ok: false, failure, rolledBack: error === null };
  };
  const record = (change: Extract<Change, { kind: "create" }>, id: string | null, applied: Applied) => {
    changes.push({ kind: "create", object: { ...change.object, id: id ?? change.object.id }, values: { ...change.values, applied } });
  };
  /** Reuses a live row, restores an archived one, or returns null so the caller creates it. */
  const reuse = async (
    table: Archivable,
    existing: ExistingRow | undefined,
    restorePatch: Values,
    change: Extract<Change, { kind: "create" }>,
  ): Promise<Outcome<boolean>> => {
    if (!existing) return { ok: true, value: false };
    realIds.set(change.object.id, existing.id);
    if (existing.archived_at === null) {
      record(change, existing.id, "existing");
      return { ok: true, value: true };
    }
    const restored = await selectId(
      client.from(table).update({ ...restorePatch, archived_at: null }).eq("id", existing.id).select("id").maybeSingle(),
    );
    if (!restored.ok) return restored;
    touched.push({ table, id: existing.id });
    record(change, existing.id, "restored");
    return { ok: true, value: true };
  };

  for (const change of planned) {
    const v = change.values;
    const table = change.object.type;

    if (table === "object_type") {
      const patch = { name_en: v.name_en, name_fr: v.name_fr, icon: v.icon ?? null };
      const reused = await reuse("object_type", existingTypes.get(String(v.key)), patch, change);
      if (!reused.ok) return fail({ code: "database", error: reused.error });
      if (reused.value) {
        typeIdByKey.set(String(v.key), realIds.get(change.object.id)!);
        continue;
      }
      const created = await selectId(
        client
          .from("object_type")
          .insert({ organization_id: organizationId, key: v.key, ...patch, kind: "custom", default_lens: "table" })
          .select("id")
          .single(),
      );
      if (!created.ok) return fail({ code: "database", error: created.error });
      realIds.set(change.object.id, created.value);
      typeIdByKey.set(String(v.key), created.value);
      touched.push({ table: "object_type", id: created.value });
      record(change, created.value, "created");
      continue;
    }

    if (table === "relation_type") {
      const patch = {
        name_en: v.name_en,
        name_fr: v.name_fr,
        reverse_name_en: v.reverse_name_en,
        reverse_name_fr: v.reverse_name_fr,
        cardinality: v.cardinality,
      };
      const existingRelation = existingRelations.get(String(v.key));
      if (
        existingRelation &&
        (existingRelation.is_native ||
          existingRelation.from_type_id !== (realIds.get(String(v.from_type_id)) ?? null) ||
          existingRelation.to_type_id !== (realIds.get(String(v.to_type_id)) ?? null))
      ) {
        return fail({ code: "relationClash", key: String(v.key) });
      }
      const reused = await reuse("relation_type", existingRelation, patch, change);
      if (!reused.ok) return fail({ code: "database", error: reused.error });
      if (reused.value) continue;
      const created = await selectId(
        client
          .from("relation_type")
          .insert({
            organization_id: organizationId,
            key: v.key,
            ...patch,
            from_type_id: realIds.get(String(v.from_type_id)) ?? null,
            to_type_id: realIds.get(String(v.to_type_id)) ?? null,
            is_native: false,
          })
          .select("id")
          .single(),
      );
      if (!created.ok) return fail({ code: "database", error: created.error });
      realIds.set(change.object.id, created.value);
      touched.push({ table: "relation_type", id: created.value });
      record(change, created.value, "created");
      continue;
    }

    if (table === "property_definition") {
      const typeId = realIds.get(String(v.type_id));
      if (!typeId) return fail({ code: "database", error: { message: `Unknown type for property "${v.key}".` } });
      const existing = existingProperties.get(`${typeId}/${v.key}`);
      if (existing && existing.kind !== v.kind) return fail({ code: "propertyKindClash", key: String(v.key) });
      const options = (v.options ?? {}) as Values;
      // A relation, formula or rollup is only reused when it is the same one;
      // its stored settings are kept, since the definer functions wrote them.
      const derived = v.kind === "relation" || v.kind === "formula" || v.kind === "rollup";
      if (existing && derived && identity(existing.kind, existing.options) !== identity(v.kind, options)) {
        return fail({ code: "propertyClash", key: String(v.key) });
      }
      if (existing?.archived_at && v.kind === "rollup" && typeof options.targetProperty === "string") {
        // Restoring skips create_rollup_property's checks; repeat the one that can
        // have changed while it was archived: the target must not be private.
        const relationProperty = planned.find(
          (c) => c.object.type === "property_definition" && c.values.type_id === v.type_id && c.values.key === options.relationProperty,
        );
        const targetTypeKey = (relationProperty?.values.options as Values | undefined)?.targetTypeKey;
        const targetTypeId = typeof targetTypeKey === "string" ? typeIdByKey.get(targetTypeKey) : undefined;
        const target = targetTypeId ? existingProperties.get(`${targetTypeId}/${options.targetProperty}`) : undefined;
        if (target?.visible_to_roles) return fail({ code: "propertyClash", key: String(v.key) });
      }
      const patch = {
        name_en: v.name_en,
        name_fr: v.name_fr,
        ...(derived ? {} : { options }),
        position: v.position,
      };
      const reused = await reuse("property_definition", existing, patch, { ...change, values: { ...v, type_id: typeId } });
      if (!reused.ok) return fail({ code: "database", error: reused.error });
      if (reused.value) continue;

      let created: Outcome<string>;
      if (v.kind === "relation") {
        const { data, error } = await client.rpc("create_native_relation_property", {
          p_type: typeId,
          p_key: v.key,
          p_name_en: v.name_en,
          p_name_fr: v.name_fr,
          p_relation_type_key: options.relationTypeKey,
          p_direction: options.direction,
          p_target_type_key: options.targetTypeKey,
        });
        created = error || typeof data !== "string" ? { ok: false, error: error ?? { message: "failed" } } : { ok: true, value: data };
      } else if (v.kind === "rollup") {
        const result = await createRollupProperty(client, {
          typeId,
          key: String(v.key),
          name: { en: String(v.name_en), fr: String(v.name_fr) },
          relationProperty: String(options.relationProperty),
          targetProperty: typeof options.targetProperty === "string" ? options.targetProperty : null,
          function: options.function as RollupFunction,
        });
        created = result.ok ? { ok: true, value: result.propertyId } : { ok: false, error: { message: result.message } };
      } else {
        created = await selectId(
          client
            .from("property_definition")
            .insert({
              organization_id: organizationId,
              type_id: typeId,
              key: v.key,
              ...patch,
              options,
              kind: v.kind,
              system_column: null,
              visible_to_roles: null,
            })
            .select("id")
            .single(),
        );
      }
      if (!created.ok) return fail({ code: "database", error: created.error });
      touched.push({ table: "property_definition", id: created.value });
      if (v.kind === "relation" || v.kind === "rollup") {
        // The definer functions append the row; put it where it was drawn.
        const placed = await selectId(
          client.from("property_definition").update({ position: v.position }).eq("id", created.value).select("id").maybeSingle(),
        );
        if (!placed.ok) return fail({ code: "database", error: placed.error });
      }
      record({ ...change, values: { ...v, type_id: typeId } }, created.value, "created");
      continue;
    }

    // Lenses, forms and workflows: their tables belong to other streams; the
    // build records them as before.
    record(change, null, "recorded");
  }

  const { data, error } = await client.rpc("blueprint_build", {
    p_blueprint: blueprintId,
    p_changes: changes,
    p_counts: plan.counts,
  });
  if (error || typeof data !== "string") return fail({ code: "database", error: error ?? { message: "failed" } });
  return { ok: true, changeSetId: data, changes, count: changes.length };
}

/** How long a build can be undone (plan A8), as public.blueprint_undo_build enforces. */
const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type UndoResult = { ok: true } | { ok: false; error: DbError; restored: boolean };

/**
 * Undoes a build: archives every row it created or restored, newest first,
 * then marks the build undone. If the database refuses the undo afterwards
 * (too old, already undone, not an admin), the rows are brought back.
 */
export async function undoBlueprintChanges(client: BuildClient, changeSetId: Uuid): Promise<UndoResult> {
  const { data, error } = await client
    .from("blueprint_build")
    .select("changes, built_at, undone_at")
    .eq("change_set_id", changeSetId)
    .maybeSingle();
  if (error) return { ok: false, error, restored: true };
  const build = data as { changes: unknown; built_at?: string; undone_at: string | null } | null;
  if (!build) return { ok: false, error: { code: "42501", message: "No such build." }, restored: true };
  if (build.undone_at) return { ok: false, error: { message: "This build was already undone." }, restored: true };
  // The database checks this too; checking first means nothing is archived for an undo it will refuse.
  if (build.built_at && Date.parse(build.built_at) < Date.now() - UNDO_WINDOW_MS) {
    return { ok: false, error: { message: "Builds can be undone for 30 days." }, restored: true };
  }

  const rows = rowsToUndo(build.changes);
  const archived: { table: Archivable; id: string }[] = [];
  /** Brings archived rows back; true only when every one came back. */
  const restore = async (): Promise<boolean> => {
    let all = true;
    for (const row of archived) {
      const result = await selectId(
        client.from(row.table).update({ archived_at: null }).eq("id", row.id).select("id").maybeSingle(),
      );
      if (!result.ok) all = false;
    }
    return all;
  };
  for (const row of [...rows].reverse()) {
    const result = await selectId(
      client.from(row.table).update({ archived_at: new Date().toISOString() }).eq("id", row.id).select("id").maybeSingle(),
    );
    if (!result.ok) return { ok: false, error: result.error, restored: await restore() };
    archived.push(row);
  }

  const undone = await client.rpc("blueprint_undo_build", { p_change_set: changeSetId });
  if (undone.error) return { ok: false, error: undone.error, restored: await restore() };
  return { ok: true };
}
