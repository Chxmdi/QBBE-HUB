import type { CatalogProperty, LensCatalog } from "@/lib/query/catalog";
import { OPERATORS_BY_KIND, type LensPropertyKind } from "@/lib/query/spec";
import { conditionOperators, objectEventVerbs } from "./graph";
import type { RecentEvent } from "./services/workflow.queries";

/**
 * The options the workflow pickers offer (U10), built with no React and no
 * I/O so they are unit-tested on their own.
 *
 * A condition tests a path into the run's scope. The property picker turns the
 * lens catalog (the properties each type exposes, with their kinds) into such
 * paths: `event.changes.<property>.after` for the new value and `.before` for
 * the old one, plus a few facts about the event itself.
 */

export type ConditionOperator = (typeof conditionOperators)[number];

/** Workflow object types global_search can find by title. */
export const searchableTypes = ["task", "project", "meeting", "event", "risk", "document", "contact"] as const;

/** Where each searchable type keeps its title, to name a saved id (same tables as global_search). */
export const recordTitleSource: Record<(typeof searchableTypes)[number], { table: string; title: string }> = {
  task: { table: "task", title: "title" },
  project: { table: "project", title: "name" },
  meeting: { table: "meeting", title: "title" },
  event: { table: "event", title: "name" },
  risk: { table: "risk", title: "title" },
  document: { table: "document", title: "title" },
  contact: { table: "crm_contact", title: "full_name" },
};

export type PropertyGroupKind = LensPropertyKind | "event";

export interface PropertyOption {
  /** The scope path, e.g. `event.changes.status.after`. */
  path: string;
  kind: PropertyGroupKind;
  /** The property's name in the reader's language. */
  name: string;
  /** "after", "before" or "" for an event fact. */
  side: "after" | "before" | "";
  /** Fixed values the property takes, for a value field with suggestions. */
  choices: { key: string; label: string }[];
}

export interface PropertyGroup {
  kind: PropertyGroupKind;
  options: PropertyOption[];
}

/**
 * The lens operators each kind accepts, as the condition operators the engine
 * runs. Lens operators the engine has no equivalent for are left out.
 */
const OPERATOR_MAP: Record<string, ConditionOperator> = {
  equals: "eq",
  not_equals: "neq",
  is: "eq",
  is_not: "neq",
  eq: "eq",
  neq: "neq",
  lt: "lt",
  lte: "lte",
  gt: "gt",
  gte: "gte",
  before: "lt",
  after: "gt",
  on_or_before: "lte",
  on_or_after: "gte",
  is_any_of: "in",
  has_any: "contains",
  contains: "contains",
  is_empty: "is_empty",
  is_not_empty: "is_not_empty",
};

/** The condition operators for a property kind, from OPERATORS_BY_KIND. */
export function operatorsForKind(kind: PropertyGroupKind | null | undefined): readonly ConditionOperator[] {
  if (!kind || kind === "event") return conditionOperators;
  const mapped: ConditionOperator[] = [];
  for (const operator of OPERATORS_BY_KIND[kind]) {
    const condition = OPERATOR_MAP[operator];
    if (condition && !mapped.includes(condition)) mapped.push(condition);
  }
  // A person is stored as an id: "is" and "is not" are the natural tests.
  if (kind === "person") for (const extra of ["eq", "neq"] as const) if (!mapped.includes(extra)) mapped.unshift(extra);
  return mapped;
}

function localized(text: { en: string; fr: string }, locale: string): string {
  return locale.startsWith("fr") ? text.fr : text.en;
}

const EVENT_FACTS: { path: string; name: { en: string; fr: string }; choices?: readonly string[] }[] = [
  { path: "event.verb", name: { en: "What happened", fr: "Ce qui est arrivé" }, choices: objectEventVerbs },
  { path: "event.object.type", name: { en: "Type of item", fr: "Type d’élément" } },
  { path: "event.object.id", name: { en: "Item id", fr: "Identifiant de l’élément" } },
  { path: "event.actor.id", name: { en: "Who did it", fr: "Qui l’a fait" } },
  { path: "event.summary", name: { en: "Summary", fr: "Résumé" } },
];

/**
 * Paths for the trigger's types, grouped by kind. With no type chosen, every
 * catalog type's properties are offered once per key.
 */
export function propertyOptions(catalog: LensCatalog, objectTypes: readonly string[], locale: string): PropertyGroup[] {
  const types = objectTypes.length > 0
    ? objectTypes.map((key) => catalog[key]).filter((type): type is NonNullable<typeof type> => Boolean(type))
    : Object.values(catalog);
  const seen = new Set<string>();
  const byKind = new Map<PropertyGroupKind, PropertyOption[]>();
  const add = (option: PropertyOption) => {
    const group = byKind.get(option.kind) ?? [];
    group.push(option);
    byKind.set(option.kind, group);
  };
  byKind.set("event", EVENT_FACTS.map((fact) => ({
    path: fact.path,
    kind: "event",
    name: localized(fact.name, locale),
    side: "",
    choices: (fact.choices ?? []).map((key) => ({ key, label: key })),
  })));
  for (const type of types) {
    for (const property of type.properties as CatalogProperty[]) {
      if (seen.has(property.key)) continue;
      seen.add(property.key);
      const choices = (property.choices ?? []).map((choice) => ({ key: choice.key, label: localized(choice.label, locale) }));
      const name = localized(property.name, locale);
      for (const side of ["after", "before"] as const) {
        add({ path: `event.changes.${property.key}.${side}`, kind: property.kind, name, side, choices });
      }
    }
  }
  return [...byKind.entries()].map(([kind, options]) => ({ kind, options }));
}

/** The option a path names, if the picker offers it. */
export function findPropertyOption(groups: readonly PropertyGroup[], path: string): PropertyOption | null {
  for (const group of groups) {
    const found = group.options.find((option) => option.path === path);
    if (found) return found;
  }
  return null;
}

/** Catalog property keys for the trigger's "only when this property changes". */
export function changedPropertyOptions(
  catalog: LensCatalog,
  objectTypes: readonly string[],
  locale: string,
): { key: string; name: string; kind: LensPropertyKind }[] {
  const seen = new Set<string>();
  const options: { key: string; name: string; kind: LensPropertyKind }[] = [];
  for (const group of propertyOptions(catalog, objectTypes, locale)) {
    for (const option of group.options) {
      if (option.kind === "event" || option.side !== "after") continue;
      const key = option.path.slice("event.changes.".length, -".after".length);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ key, name: option.name, kind: option.kind });
    }
  }
  return options;
}

export interface EventOption {
  id: string;
  label: string;
  description: string;
  event: RecentEvent;
}

/** One line per recent event: what changed, on which item, when. */
export function eventOptions(
  events: readonly RecentEvent[],
  format: { dateTime: (iso: string) => string; verb: (verb: string) => string },
): EventOption[] {
  return events.map((event) => {
    const change = event.changes[0];
    const changeText = change
      ? ` · ${change.property}: ${String(change.before ?? "—")} → ${String(change.after ?? "—")}`
      : "";
    return {
      id: event.id,
      label: event.summary || `${format.verb(event.verb)} ${event.objectType}`,
      description: `${format.verb(event.verb)} · ${format.dateTime(event.occurredAt)}${changeText}`,
      event,
    };
  });
}
