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
import { QueryError } from "./errors";
import { runLens, type LensResult, type LensValue, type RpcClient } from "./run";
import type { LensCondition, LensNode, LensSpec } from "./spec";

/**
 * Bridges the W0-3 contract (`QuerySpec` / `RunQuery` in contracts.ts) to the
 * engine's spec, which follows the W0-8 spike. Code written against the
 * contract keeps working: `createLensRunQuery` replaces `createTaskQueryStub`.
 *
 * Contract features the engine does not have yet are refused with a
 * QueryError rather than silently ignored: several types in one query,
 * `spaceIds`, `parentObjectId`, and relation paths deeper than one step.
 */

interface AdapterOptions {
  timeZone?: string;
  now?: () => Date;
}

const DEFAULT_PAGE = 100;

function fail(message: string): never {
  throw new QueryError("invalid_spec", message);
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
      if (!day) fail("Could not work out the date.");
      return { date: day };
    }
  }
  return fail("Expected a date.");
}

function personValue(value: FilterValue | undefined): unknown {
  if (isRelative(value) && value.relative === "me") return { relative: "me" };
  if (typeof value === "string") return value;
  return fail("Expected a person.");
}

function leaf(filter: PropertyFilter, property: CatalogProperty, key: string, options: AdapterOptions): LensCondition {
  const { op, value } = filter;
  if (op === "is_empty" || op === "is_not_empty") return { property: key, operator: op };
  switch (property.kind) {
    case "text": {
      const operator = ({ eq: "equals", neq: "not_equals", contains: "contains" } as const)[op as "eq"];
      if (!operator || typeof value !== "string") break;
      return { property: key, operator, value };
    }
    case "number": {
      if (!["eq", "neq", "lt", "lte", "gt", "gte"].includes(op) || typeof value !== "number") break;
      return { property: key, operator: op as "eq", value };
    }
    case "date": {
      const operator = ({ eq: "is", lt: "before", lte: "on_or_before", gt: "after", gte: "on_or_after" } as const)[
        op as "eq"
      ];
      if (!operator) break;
      return { property: key, operator, value: dateValue(value, options) };
    }
    case "select": {
      if (op === "in" && Array.isArray(value)) return { property: key, operator: "is_any_of", value };
      if ((op === "eq" || op === "neq") && typeof value === "string") {
        return { property: key, operator: op === "eq" ? "is" : "is_not", value };
      }
      break;
    }
    case "person":
    case "relation": {
      if (op === "eq" || op === "contains") {
        return { property: key, operator: "contains", value: property.kind === "person" ? personValue(value) : value };
      }
      if (op === "neq") {
        return { property: key, operator: "not_contains", value: property.kind === "person" ? personValue(value) : value };
      }
      break;
    }
    case "checkbox": {
      if (op === "eq" && typeof value === "boolean") return { property: key, operator: "is", value };
      break;
    }
  }
  return fail(`"${op}" is not supported for "${key}".`);
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
  if (path.via.length !== 1) fail("Only one relation step is supported.");
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

export function fromContractSpec(spec: QuerySpec, catalog: LensCatalog, options: AdapterOptions = {}): LensSpec {
  if (spec.version !== 1) fail("Unknown query version.");
  if (spec.types.length !== 1) fail("A lens queries one type.");
  if (spec.spaceIds?.length || spec.parentObjectId) fail("Space and parent scopes arrive with spaces (M10a).");
  const type = spec.types[0];
  if (!catalog[type]) throw new QueryError("unknown_type", "Unknown type.");
  const plain = (path: QuerySpec["groupBy"]): string => {
    if (typeof path !== "string") fail("Sorting and grouping by a related property is not supported.");
    return path;
  };
  const where = spec.filter ? node(spec.filter, type, catalog, options) : undefined;
  const offset = spec.cursor ? Number.parseInt(spec.cursor, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) fail("Unknown cursor.");
  return {
    version: 1,
    type,
    ...(where ? { where: "property" in where ? { and: [where] } : where } : {}),
    ...(spec.sorts?.length
      ? { sort: spec.sorts.map((s) => ({ property: plain(s.property), direction: s.direction })) }
      : {}),
    ...(spec.groupBy ? { groupBy: { property: plain(spec.groupBy) } } : {}),
    ...(spec.properties?.length ? { select: spec.properties } : {}),
    limit: spec.limit ?? DEFAULT_PAGE,
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

/** The contract's RunQuery, answered by the engine. Replaces createTaskQueryStub. */
export function createLensRunQuery(client: RpcClient, catalog: LensCatalog, options: AdapterOptions = {}): RunQuery {
  return async (spec) => {
    const lens = fromContractSpec(spec, catalog, options);
    const result = await runLens(client, lens, { timeZone: options.timeZone });
    return toQueryResult(result, catalog);
  };
}
