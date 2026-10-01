import {
  nativeObjectTypeKeys,
  type Change,
  type QuerySpec,
  type Uuid,
} from "@/lib/objects/contracts";
import { formulaDependencies, parseFormula } from "@/features/objects/formula";
import { previewBlueprint } from "./preview";
import { findPropertyByName, type Blueprint, type BlueprintProperty, type BlueprintType } from "./schema";

/**
 * Turns an approved blueprint into the ordered list of changes that building
 * applies as ONE change set (plan A8). Pure: ids come from `newId`, so the
 * same input gives the same plan in tests.
 *
 * Contract additions (listed in the PR): the `object.type` of each `create`
 * names the structure table it lands in once S1 builds it, one of
 * `structureKinds` below, and `values` uses that table's column names from
 * docs/design/workspace-os-object-layer.md. Until those tables exist the
 * database stand-in (`blueprint_build`) records the plan, and undo marks it
 * undone; integration swaps the stand-in for real writes.
 */

export const structureKinds = [
  "object_type",
  "property_definition",
  "relation_type",
  "lens",
  "form",
  "workflow",
] as const;
export type StructureKind = (typeof structureKinds)[number];

/** Keys already taken in the workspace, so a build cannot clash with them. */
export interface ExistingKeys {
  types: Iterable<string>;
  relations: Iterable<string>;
}

export type Conflict = { kind: "type" | "relation"; key: string };

/** Native type keys and `page` are always taken. */
export function findConflicts(blueprint: Blueprint, existing: ExistingKeys): Conflict[] {
  const types = new Set<string>([...nativeObjectTypeKeys, "page", ...existing.types]);
  const relations = new Set<string>(existing.relations);
  return [
    ...blueprint.types.filter((t) => types.has(t.key)).map((t) => ({ kind: "type" as const, key: t.key })),
    ...blueprint.relations
      .filter((r) => relations.has(r.key))
      .map((r) => ({ kind: "relation" as const, key: r.key })),
  ];
}

export interface BuildPlan {
  changes: Change[];
  counts: Record<StructureKind, number>;
}

export function planBlueprint(
  blueprint: Blueprint,
  newId: () => Uuid = () => crypto.randomUUID(),
): BuildPlan {
  const changes: Change[] = [];
  const counts = Object.fromEntries(structureKinds.map((k) => [k, 0])) as Record<StructureKind, number>;
  const create = (kind: StructureKind, values: Record<string, unknown>): Uuid => {
    const id = newId();
    changes.push({ kind: "create", object: { id, type: kind }, values: { ...values, blueprint_key: blueprint.key } });
    counts[kind] += 1;
    return id;
  };

  const preview = previewBlueprint(blueprint);
  const typeIds = new Map<string, Uuid>();
  for (const type of blueprint.types) {
    typeIds.set(
      type.key,
      create("object_type", {
        key: type.key,
        name_en: type.name.en,
        name_fr: type.name.fr,
        icon: type.icon ?? null,
        kind: "custom",
        native_table: null,
        default_lens: "table",
      }),
    );
  }

  // Relations before properties, so a relation property can name its type.
  const relationIds = new Map<string, Uuid>();
  for (const relation of blueprint.relations) {
    relationIds.set(
      relation.key,
      create("relation_type", {
        key: relation.key,
        name_en: relation.name.en,
        name_fr: relation.name.fr,
        reverse_name_en: relation.reverseName.en,
        reverse_name_fr: relation.reverseName.fr,
        cardinality: relation.cardinality,
        from_type_id: typeIds.get(relation.from),
        to_type_id: typeIds.get(relation.to),
        is_native: false,
      }),
    );
  }

  for (const { type, property, position } of orderProperties(blueprint)) {
    const relation = property.relation ? blueprint.relations.find((r) => r.key === property.relation) : undefined;
    const outgoing = relation ? relationDirection(type, property, relation) === "outgoing" : false;
    create("property_definition", {
      type_id: typeIds.get(type.key),
      type_key: type.key,
      key: property.key,
      name_en: property.name.en,
      name_fr: property.name.fr,
      kind: property.kind,
      options: {
        ...(property.choices ? { choices: property.choices.map((c) => ({ ...c, color: null })) } : {}),
        ...(property.currency ? { currency: property.currency } : {}),
        ...(relation
          ? {
              relationTypeKey: relation.key,
              relationTypeId: relationIds.get(relation.key),
              // What the database's relation and rollup functions read (V1-7).
              direction: outgoing ? "outgoing" : "incoming",
              targetTypeKey: outgoing ? relation.to : relation.from,
            }
          : {}),
        ...(property.kind === "formula" && property.expression ? { expression: property.expression } : {}),
        ...(property.kind === "rollup" && property.rollup
          ? {
              relationProperty: property.rollup.relation,
              targetProperty: property.rollup.function === "count" ? null : (property.rollup.target ?? null),
              function: property.rollup.function,
            }
          : {}),
        ...(property.required ? { required: true } : {}),
      },
      system_column: null,
      visible_to_roles: null,
      position,
    });
  }

  for (const lens of preview.lenses) {
    const type = blueprint.types.find((t) => t.key === lens.type)!;
    const query: QuerySpec = {
      version: 1,
      types: [lens.type],
      properties: type.properties.map((p) => p.key),
      ...(lens.groupBy ? { groupBy: lens.groupBy } : {}),
    };
    create("lens", {
      key: lens.key,
      type_id: typeIds.get(lens.type),
      kind: lens.kind,
      name_en: lens.name.en,
      name_fr: lens.name.fr,
      query,
    });
  }

  for (const form of preview.forms) {
    create("form", {
      key: form.key,
      type_id: typeIds.get(form.type),
      name_en: form.name.en,
      name_fr: form.name.fr,
      fields: form.fields,
    });
  }

  for (const workflow of preview.workflows) {
    create("workflow", {
      key: workflow.key,
      type_id: typeIds.get(workflow.type),
      name_en: workflow.name.en,
      name_fr: workflow.name.fr,
      trigger: workflow.trigger,
      steps: workflow.steps,
      enabled: false,
    });
  }

  return { changes, counts };
}

/**
 * Which way a relation property reads its relation. On a relation between two
 * types that is fixed by the type. On a relation from a type to itself (a
 * manager and their reports), the first property naming it reads forwards
 * and the second backwards, so the two sides stay different.
 */
export function relationDirection(
  type: BlueprintType,
  property: BlueprintProperty,
  relation: Blueprint["relations"][number],
): "outgoing" | "incoming" {
  if (relation.from !== relation.to) return relation.from === type.key ? "outgoing" : "incoming";
  const sides = type.properties.filter((p) => p.kind === "relation" && p.relation === relation.key);
  return sides.indexOf(property) <= 0 ? "outgoing" : "incoming";
}

export interface PlannedProperty {
  type: BlueprintType;
  property: BlueprintProperty;
  /** Where the property sits on its type, as drawn. */
  position: number;
}

/**
 * Every property of every type, ordered so that a formula or rollup comes
 * after the properties it reads: a rollup after its relation property and
 * the number it summarises on the related type, a formula after the
 * properties (other formulas included) its expression names. Plain
 * properties keep their drawn order. Building applies rows in this order, so
 * the database's rollup function always finds what a rollup refers to.
 */
export function orderProperties(blueprint: Blueprint): PlannedProperty[] {
  const relations = new Map(blueprint.relations.map((r) => [r.key, r]));
  const all: PlannedProperty[] = blueprint.types.flatMap((type) =>
    type.properties.map((property, position) => ({ type, property, position })),
  );
  const id = (typeKey: string, propertyKey: string) => `${typeKey}.${propertyKey}`;
  const resolveName = (type: BlueprintType, name: string) => findPropertyByName(type, name)?.key;

  const dependencies = new Map<string, string[]>();
  for (const { type, property } of all) {
    const needs: string[] = [];
    if (property.kind === "rollup" && property.rollup) {
      needs.push(id(type.key, property.rollup.relation));
      const relationProperty = type.properties.find((p) => p.key === property.rollup!.relation);
      const relation = relationProperty?.relation ? relations.get(relationProperty.relation) : undefined;
      if (relation && property.rollup.target) {
        needs.push(id(relation.from === type.key ? relation.to : relation.from, property.rollup.target));
      }
    } else if (property.kind === "formula" && property.expression) {
      try {
        for (const name of formulaDependencies(parseFormula(property.expression))) {
          const key = resolveName(type, name);
          if (key && key !== property.key) needs.push(id(type.key, key));
        }
      } catch {
        // An unparsable formula is refused by validation; it has no dependencies to order.
      }
    }
    dependencies.set(id(type.key, property.key), needs);
  }

  const known = new Set(all.map(({ type, property }) => id(type.key, property.key)));
  const placed = new Set<string>();
  const ordered: PlannedProperty[] = [];
  let remaining = all;
  while (remaining.length) {
    const ready = remaining.filter(({ type, property }) =>
      (dependencies.get(id(type.key, property.key)) ?? []).every((need) => !known.has(need) || placed.has(need)),
    );
    // A loop (refused by validation) still has to end: place what is left as drawn.
    const batch = ready.length ? ready : remaining;
    for (const item of batch) placed.add(id(item.type.key, item.property.key));
    ordered.push(...batch);
    remaining = remaining.filter((item) => !placed.has(id(item.type.key, item.property.key)));
  }
  return ordered;
}
