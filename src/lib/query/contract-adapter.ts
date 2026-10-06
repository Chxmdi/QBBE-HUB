import type {
  FilterNode,
  FilterValue,
  PropertyFilter,
  PropertyValue,
  QueryResult,
  QuerySpec,
  RunQuery,
} from "@/lib/objects/contracts";
import { addCalendarDays, calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";
import { findProperty, type CatalogProperty, type LensCatalog } from "./catalog";
import { QueryError, type QueryErrorCode } from "./errors";
import { runLens, type LensResult, type LensValue, type RpcClient } from "./run";
import { LIMITS, type LensCondition, type LensNode, type LensSpec } from "./spec";

/**
 * Bridges the W0-3 contract (`QuerySpec` / `RunQuery` in contracts.ts) to the
 * engine's spec, which follows the W0-8 spike. Code written against the
 * contract keeps working: `createLensRunQuery` replaces `createTaskQueryStub`
 * for every type the engine's catalog knows (I2).
 *
 * The mapping, per property kind:
 *   text          eq/neq/contains, and `in` as an `or` of equals
 *   number        eq/neq/lt/lte/gt/gte
 *   date          eq/lt/lte/gt/gte, neq as before-or-after; values are a day,
 *                 today, this_week or days_from_today
 *   select        eq/neq/in
 *   multi_select  eq/contains (has_any), neq (has_none), in (has_any)
 *   person        eq/contains/neq with an id or "me"; `in` as an `or`
 *   relation      eq/contains/neq with an id; `in` as an `or`; one `via` step
 *                 becomes `matches`
 *   checkbox      eq true/false
 *   any kind      is_empty / is_not_empty
 *
 * Anything the engine cannot express is refused with a QueryError rather than
 * silently ignored: several types in one query, `spaceIds`, `parentObjectId`,
 * relation paths deeper than one step, sorting or grouping through a relation,
 * and operators a kind does not take. `isQueryRefusal` tells those apart from
 * a failure running the query.
 */

export interface AdapterOptions {
  timeZone?: string;
  now?: () => Date;
}

const DEFAULT_PAGE = 100;

function fail(message: string, code: QueryErrorCode = "invalid_spec"): never {
  throw new QueryError(code, message);
}

function isRelative(value: FilterValue | undefined): value is Extract<FilterValue, { relative: string }> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateValue(value: FilterValue | undefined, options: AdapterOptions): unknown {
  if (typeof value === "string") return { date: value.slice(0, 10) };
  if (isRelative(value)) {
    if (value.relative === "today" || value.relative === "this_week") return { relative: value.relative };
    if (value.relative === "days_from_today") {
      const today = calendarDateInZone((options.now ?? (() => new Date()))(), options.timeZone ?? DEFAULT_TIME_ZONE);
      const day = today ? addCalendarDays(today, value.days) : null;
      if (!day) fail("Could not work out the date.", "bad_value");
      return { date: day };
    }
  }
  return fail("Expected a date.", "bad_value");
}

function personValue(value: FilterValue | undefined): unknown {
  if (isRelative(value) && value.relative === "me") return { relative: "me" };
  if (typeof value === "string") return value;
  return fail("Expected a person.", "bad_value");
}

function idValue(value: FilterValue | undefined): string {
  if (typeof value === "string") return value;
  return fail("Expected an object id.", "bad_value");
}

function stringList(value: FilterValue | undefined): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) {
    fail("Expected a list of values.", "bad_value");
  }
  return value as string[];
}

/** `in` on a kind the engine matches one value at a time: an `or` of single matches. */
function anyOf(items: unknown[], make: (item: unknown) => LensCondition): LensNode {
  const conditions = items.map(make);
  return conditions.length === 1 ? conditions[0] : { or: conditions };
}

function leaf(filter: PropertyFilter, property: CatalogProperty, key: string, options: AdapterOptions): LensNode {
  const { op, value } = filter;
  if (op === "is_empty" || op === "is_not_empty") return { property: key, operator: op };
  switch (property.kind) {
    case "text": {
      if (op === "in") return anyOf(stringList(value), (item) => ({ property: key, operator: "equals", value: item }));
      const operator = ({ eq: "equals", neq: "not_equals", contains: "contains" } as const)[op as "eq"];
      if (!operator) break;
      if (typeof value !== "string") fail("Expected text.", "bad_value");
      return { property: key, operator, value };
    }
    case "number": {
      if (!["eq", "neq", "lt", "lte", "gt", "gte"].includes(op)) break;
      if (typeof value !== "number") fail("Expected a number.", "bad_value");
      return { property: key, operator: op as "eq", value };
    }
    case "date": {
      if (op === "neq") {
        const day = dateValue(value, options);
        return {
          or: [
            { property: key, operator: "before", value: day },
            { property: key, operator: "after", value: day },
          ],
        };
      }
      const operator = ({ eq: "is", lt: "before", lte: "on_or_before", gt: "after", gte: "on_or_after" } as const)[
        op as "eq"
      ];
      if (!operator) break;
      return { property: key, operator, value: dateValue(value, options) };
    }
    case "select": {
      if (op === "in") return { property: key, operator: "is_any_of", value: stringList(value) };
      if (op !== "eq" && op !== "neq") break;
      if (typeof value !== "string") fail("Expected an option.", "bad_value");
      return { property: key, operator: op === "eq" ? "is" : "is_not", value };
    }
    case "multi_select": {
      if (op === "in") return { property: key, operator: "has_any", value: stringList(value) };
      if (op !== "eq" && op !== "neq" && op !== "contains") break;
      if (typeof value !== "string") fail("Expected an option.", "bad_value");
      return { property: key, operator: op === "neq" ? "has_none" : "has_any", value: [value] };
    }
    case "person": {
      if (op === "in") {
        return anyOf(stringList(value), (item) => ({ property: key, operator: "contains", value: item }));
      }
      if (op !== "eq" && op !== "neq" && op !== "contains") break;
      return { property: key, operator: op === "neq" ? "not_contains" : "contains", value: personValue(value) };
    }
    case "relation": {
      if (op === "in") {
        return anyOf(stringList(value), (item) => ({ property: key, operator: "contains", value: item }));
      }
      if (op !== "eq" && op !== "neq" && op !== "contains") break;
      return { property: key, operator: op === "neq" ? "not_contains" : "contains", value: idValue(value) };
    }
    case "checkbox": {
      if (op !== "eq") break;
      if (typeof value !== "boolean") fail("Expected true or false.", "bad_value");
      return { property: key, operator: "is", value };
    }
  }
  return fail(`"${op}" is not supported for "${key}".`, "bad_operator");
}

function node(filter: FilterNode, type: string, catalog: LensCatalog, options: AdapterOptions): LensNode {
  if ("and" in filter) return { and: filter.and.map((f) => node(f, type, catalog, options)) };
  if ("or" in filter) return { or: filter.or.map((f) => node(f, type, catalog, options)) };
  const path = filter.property;
  if (typeof path === "string") {
    const property = findProperty(catalog, type, path);
    if (!property) throw new QueryError("unknown_property", "Unknown property.");
    return leaf(filter, property, path, options);
  }
  if (path.via.length !== 1) fail("Only one relation step is supported.", "too_complex");
  const relation = findProperty(catalog, type, path.via[0]);
  if (!relation || relation.kind !== "relation" || !relation.target) {
    throw new QueryError("unknown_property", "Unknown relation.");
  }
  const inner = node({ ...filter, property: path.property }, relation.target, catalog, options);
  return {
    property: path.via[0],
    operator: "matches",
    value: { where: "property" in inner ? { and: [inner] } : inner },
  };
}

/**
 * The order a spec without sorts gets: newest first, as the stand-in this
 * adapter replaced always gave (`createTaskQueryStub`). Without it the engine
 * falls back to id order, so a screen built without sorts (an app's lens
 * screen, a dashboard tile) showed an arbitrary page of records rather than
 * the latest ones. Only when the type can sort by its creation time.
 */
function defaultSort(catalog: LensCatalog, type: string): LensSpec["sort"] {
  const created = findProperty(catalog, type, "created_time");
  return created?.sortable ? [{ property: "created_time", direction: "desc" }] : undefined;
}

export function fromContractSpec(spec: QuerySpec, catalog: LensCatalog, options: AdapterOptions = {}): LensSpec {
  if (spec.version !== 1) fail("Unknown query version.");
  if (spec.types.length !== 1) fail("A lens queries one type.");
  if (spec.spaceIds?.length || spec.parentObjectId) fail("Space and parent scopes arrive with spaces (M10a).");
  const type = spec.types[0];
  if (!catalog[type]) throw new QueryError("unknown_type", "Unknown type.");
  const plain = (path: QuerySpec["groupBy"]): string => {
    if (typeof path !== "string") fail("Sorting and grouping by a related property is not supported.", "too_complex");
    return path;
  };
  const where = spec.filter ? node(spec.filter, type, catalog, options) : undefined;
  const offset = spec.cursor ? Number.parseInt(spec.cursor, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) fail("Unknown cursor.");
  const limit = Math.min(Math.max(spec.limit ?? DEFAULT_PAGE, 1), LIMITS.maxPageSize);
  const sort = spec.sorts?.length
    ? spec.sorts.map((s) => ({ property: plain(s.property), direction: s.direction }))
    : defaultSort(catalog, type);
  return {
    version: 1,
    type,
    ...(where ? { where: "property" in where ? { and: [where] } : where } : {}),
    ...(sort ? { sort } : {}),
    ...(spec.groupBy ? { groupBy: { property: plain(spec.groupBy) } } : {}),
    ...(spec.properties?.length ? { select: [...new Set(spec.properties)] } : {}),
    limit,
    offset,
  };
}

function toPropertyValue(property: CatalogProperty | undefined, raw: LensValue): PropertyValue | null {
  if (raw === null || raw === undefined || !property) return null;
  const kind = property.propertyKind;
  if (typeof raw === "object") {
    if (property.kind === "relation" || kind === "relation") {
      return { kind: "relation", value: [{ id: raw.id, type: property.target ?? property.ref?.table ?? "object" }] };
    }
    return { kind: kind as "person", value: [raw.id] };
  }
  switch (kind) {
    case "number":
    case "currency":
    case "duration":
    case "progress":
    case "rating":
      return { kind, value: Number(raw) };
    case "checkbox":
      return { kind, value: raw === true };
    case "date":
    case "created_time":
    case "edited_time":
      return { kind, value: String(raw) };
    default:
      return { kind: kind as "text", value: String(raw) };
  }
}

export function toQueryResult(result: LensResult, catalog: LensCatalog): QueryResult {
  const properties = catalog[result.type]?.properties ?? [];
  const byKey = new Map(properties.map((p) => [p.key, p]));
  const rows = result.rows.map((row) => ({
    ref: { id: row.id, type: result.type },
    title: row.title,
    values: Object.fromEntries(
      Object.entries(row.values).map(([key, value]) => [key, toPropertyValue(byKey.get(key), value)]),
    ),
  }));
  let groups: QueryResult["groups"];
  if (result.groupBy) {
    const order = new Map<string | null, string[]>();
    for (const g of result.groups ?? []) order.set(g.key, []);
    for (const row of result.rows) {
      const ids = order.get(row.group) ?? [];
      ids.push(row.id);
      order.set(row.group, ids);
    }
    groups = [...order.entries()].map(([key, rowIds]) => ({ key, rowIds }));
  }
  const next = result.offset + result.rows.length;
  return { rows, groups, nextCursor: next < result.total ? String(next) : null };
}

/** The contract's RunQuery, answered by the engine for every type in the catalog. */
export function createLensRunQuery(client: RpcClient, catalog: LensCatalog, options: AdapterOptions = {}): RunQuery {
  return async (spec) => {
    const lens = fromContractSpec(spec, catalog, options);
    const result = await runLens(client, lens, { timeZone: options.timeZone });
    return toQueryResult(result, catalog);
  };
}
