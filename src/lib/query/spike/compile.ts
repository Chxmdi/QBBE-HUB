// W0-8 spike: compile a query spec into parameterised SQL.
//
// Safety rules, each enforced here and proven in the tests:
// 1. Every value from the spec goes into `values` and appears in the SQL as a
//    numbered bind parameter ($1, $2, ...) with a cast chosen by this file.
// 2. The only identifiers in the SQL are constants in this file and
//    SYSTEM_COLUMNS in catalog.ts. Property names, operators, sort and group
//    keys are looked up in the catalog / operator tables; anything not found
//    is rejected. Custom properties reach SQL as their id, bound as a value.
// 3. The SQL runs as the viewer (run.ts), so RLS decides which rows exist.
//    The compiler adds no permission logic of its own and has no way around it.

import { SYSTEM_COLUMNS, type Catalog, type CustomProperty, type ObjectType, type Property } from "./catalog";
import { addDays, isValidTimeZone, localDay, resolveDate, type DayRange } from "./dates";
import {
  LIMITS,
  OPERATORS_BY_KIND,
  dateValueSchema,
  querySpecSchema,
  type Condition,
  type Group,
  type PropertyKind,
  type QuerySpec,
} from "./spec";

export type QueryErrorCode =
  | "invalid_spec"
  | "unknown_type"
  | "unknown_property"
  | "bad_operator"
  | "bad_value"
  | "not_sortable"
  | "not_groupable"
  | "too_complex";

/** A rejected spec. Messages never repeat the caller's text back. */
export class QueryError extends Error {
  constructor(
    readonly code: QueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

export interface CompileContext {
  /** The viewer's user id, for the "me" value. Comes from the verified session, never the spec. */
  viewerId: string;
  /** IANA time zone used for "today", "this week" and timestamp comparisons. */
  timeZone: string;
  now: Date;
}

export interface CompiledQuery {
  text: string;
  values: unknown[];
}

export interface OutputColumn {
  key: string;
  kind: PropertyKind;
  source: "system" | "custom";
  id?: string;
}

export interface CompiledLens {
  spec: QuerySpec;
  page: CompiledQuery;
  count: CompiledQuery;
  groups?: CompiledQuery;
  columns: OutputColumn[];
  groupBy?: OutputColumn;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Cast = "text" | "numeric" | "date" | "uuid" | "boolean" | "jsonb" | "text[]" | "uuid[]";

class Params {
  readonly values: unknown[] = [];
  private tz?: string;
  constructor(private readonly timeZone: string) {}
  add(value: unknown, cast: Cast): string {
    this.values.push(value);
    return `$${this.values.length}::${cast}`;
  }
  /** The time zone, bound once per query. */
  zone(): string {
    this.tz ??= this.add(this.timeZone, "text");
    return this.tz;
  }
}

/** Fresh alias names, so nested subqueries never collide. */
class Aliases {
  private n = 0;
  next(prefix: "v" | "r" | "t"): string {
    return `${prefix}${this.n++}`;
  }
}

interface Scope {
  params: Params;
  aliases: Aliases;
  catalog: Catalog;
  ctx: CompileContext;
  today: string;
  conditions: number;
}

function fail(code: QueryErrorCode, message: string): never {
  throw new QueryError(code, message);
}

function property(type: ObjectType, key: string): Property {
  const p = type.properties.get(key);
  if (!p) fail("unknown_property", `Unknown property on type "${type.key}".`);
  return p;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function asString(v: unknown): string {
  if (typeof v !== "string") fail("bad_value", "Expected text.");
  return v;
}
function asNumber(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail("bad_value", "Expected a number.");
  return v;
}
function asBoolean(v: unknown): boolean {
  if (typeof v !== "boolean") fail("bad_value", "Expected true or false.");
  return v;
}
function asList(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length === 0) fail("bad_value", "Expected a non-empty list.");
  return v;
}
function asDayRange(v: unknown, today: string): DayRange {
  const parsed = dateValueSchema.safeParse(v);
  if (!parsed.success) fail("bad_value", "Expected a date or a relative date.");
  return resolveDate(parsed.data, today);
}
function asUserId(v: unknown, ctx: CompileContext): string {
  if (typeof v === "object" && v !== null && (v as { relative?: unknown }).relative === "me") return ctx.viewerId;
  const s = asString(v);
  if (!UUID.test(s)) fail("bad_value", "Expected a person id or \"me\".");
  return s.toLowerCase();
}
function asOption(p: Property, v: unknown): string {
  const s = asString(v);
  if (p.source === "system") {
    if (p.uuidValues && UUID.test(s)) return s.toLowerCase();
    fail("bad_value", "Expected an id.");
  }
  if (!p.options.some((o) => o.id === s)) fail("bad_value", `Not an option of "${p.key}".`);
  return s;
}

/** LIKE pattern with the caller's %, _ and \ taken literally. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const VALUE_COLUMN: Record<Exclude<PropertyKind, "relation">, string> = {
  text: "value_text",
  number: "value_number",
  date: "value_date",
  select: "value_text",
  multi_select: "value_json",
  person: "value_json",
  checkbox: "value_bool",
};

/**
 * A condition as "positive predicate on one value" plus "negate?". For custom
 * properties a value is a row in property_value, so negating means "no row
 * matches" — which also counts empty values as matching, as users expect
 * from "is not" / "does not contain".
 */
interface Predicate {
  sql: (col: string) => string;
  negate: boolean;
}

function datePredicate(p: Property, op: string, value: unknown, s: Scope): (col: string) => string {
  const ts = p.source === "system" && p.timestamp;
  // Start of a calendar day: a date for date columns, the instant it begins
  // in the viewer's zone for timestamp columns.
  const dayStart = (day: string) =>
    ts ? `(${s.params.add(day, "date")}::timestamp at time zone ${s.params.zone()})` : s.params.add(day, "date");
  const onOrBefore = (col: string, day: string) =>
    ts ? `${col} < ${dayStart(addDays(day, 1))}` : `${col} <= ${dayStart(day)}`;
  const after = (col: string, day: string) =>
    ts ? `${col} >= ${dayStart(addDays(day, 1))}` : `${col} > ${dayStart(day)}`;

  if (op === "between") {
    const v = value as { from?: unknown; to?: unknown } | null;
    if (typeof v !== "object" || v === null || !("from" in v) || !("to" in v)) fail("bad_value", "Expected from and to.");
    const from = asDayRange(v.from, s.today);
    const to = asDayRange(v.to, s.today);
    return (col) => `(${col} >= ${dayStart(from.start)} and ${onOrBefore(col, to.end)})`;
  }
  const r = asDayRange(value, s.today);
  switch (op) {
    case "is":
      return (col) => `(${col} >= ${dayStart(r.start)} and ${onOrBefore(col, r.end)})`;
    case "before":
      return (col) => `${col} < ${dayStart(r.start)}`;
    case "after":
      return (col) => after(col, r.end);
    case "on_or_before":
      return (col) => onOrBefore(col, r.end);
    case "on_or_after":
      return (col) => `${col} >= ${dayStart(r.start)}`;
  }
  return fail("bad_operator", "Unsupported date operator.");
}

function predicate(p: Property, op: string, value: unknown, s: Scope): Predicate {
  const { params } = s;
  const pos = (sql: (col: string) => string): Predicate => ({ sql, negate: false });
  const neg = (sql: (col: string) => string): Predicate => ({ sql, negate: true });

  switch (p.kind) {
    case "text": {
      if (op === "equals" || op === "not_equals") {
        const v = params.add(asString(value), "text");
        return (op === "equals" ? pos : neg)((col) => `${col} = ${v}`);
      }
      if (op === "contains" || op === "not_contains" || op === "starts_with") {
        const needle = likeEscape(asString(value));
        const pattern = op === "starts_with" ? `${needle}%` : `%${needle}%`;
        const v = params.add(pattern, "text");
        return (op === "not_contains" ? neg : pos)((col) => `${col} ilike ${v} escape '\\'`);
      }
      break;
    }
    case "number": {
      if (op === "between") {
        const v = value as { from?: unknown; to?: unknown } | null;
        if (typeof v !== "object" || v === null) fail("bad_value", "Expected from and to.");
        const lo = params.add(asNumber(v.from), "numeric");
        const hi = params.add(asNumber(v.to), "numeric");
        return pos((col) => `${col} between ${lo} and ${hi}`);
      }
      const sym = { eq: "=", neq: "=", lt: "<", lte: "<=", gt: ">", gte: ">=" }[op];
      if (sym) {
        const v = params.add(asNumber(value), "numeric");
        return (op === "neq" ? neg : pos)((col) => `${col} ${sym} ${v}`);
      }
      break;
    }
    case "date":
      return pos(datePredicate(p, op, value, s));
    case "select": {
      const cast: Cast = p.source === "system" ? "uuid" : "text";
      if (op === "is" || op === "is_not") {
        const v = params.add(asOption(p, value), cast);
        return (op === "is" ? pos : neg)((col) => `${col} = ${v}`);
      }
      if (op === "is_any_of" || op === "is_none_of") {
        const list = asList(value).map((x) => asOption(p, x));
        const v = params.add(list, `${cast}[]` as Cast);
        return (op === "is_any_of" ? pos : neg)((col) => `${col} = any(${v})`);
      }
      break;
    }
    case "multi_select": {
      const list = asList(value).map((x) => asOption(p, x));
      if (op === "has_all") {
        const v = params.add(JSON.stringify(list), "jsonb");
        return pos((col) => `${col} @> ${v}`);
      }
      if (op === "has_any" || op === "has_none") {
        const parts = list.map((x) => params.add(JSON.stringify([x]), "jsonb"));
        return (op === "has_any" ? pos : neg)((col) => `(${parts.map((v) => `${col} @> ${v}`).join(" or ")})`);
      }
      break;
    }
    case "person": {
      if (op === "contains" || op === "not_contains") {
        const id = asUserId(value, s.ctx);
        const make = p.source === "system"
          ? (() => {
              const v = params.add(id, "uuid");
              return (col: string) => `${col} = ${v}`;
            })()
          : (() => {
              const v = params.add(JSON.stringify([id]), "jsonb");
              return (col: string) => `${col} @> ${v}`;
            })();
        return (op === "contains" ? pos : neg)(make);
      }
      break;
    }
    case "checkbox": {
      // Unchecked includes "never set", so false is the negation of true.
      return (asBoolean(value) ? pos : neg)((col) => `${col}`);
    }
  }
  return fail("bad_operator", `Operator not allowed for "${p.key}".`);
}

function compileCondition(c: Condition, type: ObjectType, subject: string, s: Scope, depth: number, allowMatch: boolean): string {
  if (++s.conditions > LIMITS.maxConditions) fail("too_complex", "Too many conditions.");
  const p = property(type, c.property);
  const allowed = OPERATORS_BY_KIND[p.kind] as readonly string[];
  if (!allowed.includes(c.operator)) fail("bad_operator", `Operator not allowed for "${p.key}".`);
  const { params, aliases } = s;
  const emptiness = c.operator === "is_empty" || c.operator === "is_not_empty";
  if (emptiness && c.value !== undefined) fail("bad_value", "This operator takes no value.");

  if (p.kind === "relation") {
    const cp = p as CustomProperty;
    const r = aliases.next("r");
    const base = () =>
      `select 1 from wos_spike.object_relation ${r} where ${r}.from_id = ${subject}.id and ${r}.property_id = ${params.add(cp.id, "uuid")}`;
    switch (c.operator) {
      case "is_empty":
        return `not exists (${base()})`;
      case "is_not_empty":
        return `exists (${base()})`;
      case "contains":
      case "not_contains": {
        const id = asString(c.value);
        if (!UUID.test(id)) fail("bad_value", "Expected an object id.");
        const sql = `exists (${base()} and ${r}.to_id = ${params.add(id.toLowerCase(), "uuid")})`;
        return c.operator === "contains" ? sql : `not ${sql}`;
      }
      case "matches": {
        if (!allowMatch) fail("too_complex", "Only one level of relation filters is allowed.");
        const target = cp.targetType ? s.catalog.get(cp.targetType) : undefined;
        if (!target) fail("unknown_type", "The related type is not available.");
        const where = (c.value as { where?: Group } | undefined)?.where;
        if (!where) fail("bad_value", "Expected a where group.");
        const t = aliases.next("t");
        const inner = compileGroup(where, target, t, s, depth + 1, false);
        return (
          `exists (select 1 from wos_spike.object_relation ${r} join wos_spike.object ${t} on ${t}.id = ${r}.to_id` +
          ` where ${r}.from_id = ${subject}.id and ${r}.property_id = ${params.add(cp.id, "uuid")}` +
          ` and ${t}.type_id = ${params.add(target.id, "uuid")} and ${t}.archived_at is null and ${inner})`
        );
      }
    }
    return fail("bad_operator", `Operator not allowed for "${p.key}".`);
  }

  if (p.source === "system") {
    const col = `${subject}.${SYSTEM_COLUMNS[p.column]}`;
    if (c.operator === "is_empty") return p.kind === "text" ? `(${col} is null or ${col} = '')` : `${col} is null`;
    if (c.operator === "is_not_empty") return p.kind === "text" ? `(${col} is not null and ${col} <> '')` : `${col} is not null`;
    const pred = predicate(p, c.operator, c.value, s);
    return pred.negate ? `(${col} is null or not (${pred.sql(col)}))` : `(${pred.sql(col)})`;
  }

  // Custom property: one row per (object, property) in property_value.
  const v = aliases.next("v");
  const exists = (extra: string) =>
    `exists (select 1 from wos_spike.property_value ${v} where ${v}.object_id = ${subject}.id and ${v}.property_id = ${params.add(p.id, "uuid")}${extra})`;
  if (c.operator === "is_empty") return `not ${exists("")}`;
  if (c.operator === "is_not_empty") return exists("");
  const pred = predicate(p, c.operator, c.value, s);
  const col = `${v}.${VALUE_COLUMN[p.kind]}`;
  const sql = exists(` and ${pred.sql(col)}`);
  return pred.negate ? `not ${sql}` : sql;
}

function compileGroup(g: Group, type: ObjectType, subject: string, s: Scope, depth: number, allowMatch: boolean): string {
  if (depth > LIMITS.maxDepth) fail("too_complex", "Filters are nested too deeply.");
  const joiner = g.and ? " and " : " or ";
  const items = g.and ?? g.or ?? [];
  if (items.length === 0) fail("invalid_spec", "Empty filter group.");
  const parts = items.map((item) =>
    "property" in item
      ? compileCondition(item as Condition, type, subject, s, depth, allowMatch)
      : compileGroup(item as Group, type, subject, s, depth + 1, allowMatch),
  );
  return `(${parts.join(joiner)})`;
}

// ---------------------------------------------------------------------------
// Sorts, grouping, output
// ---------------------------------------------------------------------------

interface KeyExpr {
  join?: string;
  expr: string;
  /** Sorting expression (option order for selects). */
  order: string;
}

const SORTABLE: PropertyKind[] = ["text", "number", "date", "select", "checkbox"];

function keyExpr(p: Property, alias: string, params: Params, purpose: "sort" | "group"): KeyExpr {
  if (p.source === "system") {
    const col = `o.${SYSTEM_COLUMNS[p.column]}`;
    if (purpose === "group") {
      if (p.key !== "space" && p.key !== "owner") fail("not_groupable", `Cannot group by "${p.key}".`);
      return { expr: `${col}::text`, order: col };
    }
    if (p.key === "space" || p.key === "owner") fail("not_sortable", `Cannot sort by "${p.key}".`);
    return { expr: col, order: col };
  }
  if (purpose === "sort" && !SORTABLE.includes(p.kind)) fail("not_sortable", `Cannot sort by "${p.key}".`);
  if (purpose === "group" && p.kind !== "select" && p.kind !== "checkbox") fail("not_groupable", `Cannot group by "${p.key}".`);
  const kind = p.kind as Exclude<PropertyKind, "relation">;
  const join = `left join wos_spike.property_value ${alias} on ${alias}.object_id = o.id and ${alias}.property_id = ${params.add(p.id, "uuid")}`;
  const col = `${alias}.${VALUE_COLUMN[kind]}`;
  if (p.kind === "checkbox") {
    const e = `coalesce(${col}, false)`;
    return { join, expr: purpose === "group" ? `${e}::text` : e, order: e };
  }
  if (p.kind === "select") {
    const order = `array_position(${params.add(p.options.map((o) => o.id), "text[]")}, ${col})`;
    return { join, expr: col, order };
  }
  return { join, expr: col, order: col };
}

function describe(p: Property): OutputColumn {
  return p.source === "system"
    ? { key: p.key, kind: p.kind, source: "system" }
    : { key: p.key, kind: p.kind, source: "custom", id: p.id };
}

/** Parse, validate and compile a spec. Throws QueryError on anything not allowed. */
export function compileLens(input: unknown, catalog: Catalog, ctx: CompileContext): CompiledLens {
  const parsed = querySpecSchema.safeParse(input);
  if (!parsed.success) fail("invalid_spec", "The query is not in the expected format.");
  const spec = parsed.data;
  if (!UUID.test(ctx.viewerId)) fail("invalid_spec", "Missing viewer.");
  if (!isValidTimeZone(ctx.timeZone)) fail("invalid_spec", "Unknown time zone.");

  const type = catalog.get(spec.type);
  if (!type) fail("unknown_type", "Unknown type.");

  const today = localDay(ctx.now, ctx.timeZone);

  // Each statement gets its own parameter list, built from the same spec.
  const build = (withSort: boolean, withGroup: boolean) => {
    const params = new Params(ctx.timeZone);
    const s: Scope = { params, aliases: new Aliases(), catalog, ctx, today, conditions: 0 };
    const joins: string[] = [];
    const typeParam = params.add(type.id, "uuid");
    const where = spec.where ? compileGroup(spec.where, type, "o", s, 1, true) : "true";

    let group: KeyExpr | undefined;
    if (withGroup && spec.groupBy) {
      group = keyExpr(property(type, spec.groupBy.property), "g", params, "group");
      if (group.join) joins.push(group.join);
    }
    const order: string[] = [];
    if (withSort) {
      if (group) order.push(`${group.order} asc nulls last`);
      spec.sort.forEach((sort, i) => {
        const k = keyExpr(property(type, sort.property), `s${i}`, params, "sort");
        if (k.join) joins.push(k.join);
        order.push(`${k.order} ${sort.direction === "desc" ? "desc" : "asc"} nulls last`);
      });
      order.push("o.id asc");
    }
    const from = `from wos_spike.object o${joins.map((j) => ` ${j}`).join("")} where o.type_id = ${typeParam} and o.archived_at is null and ${where}`;
    return { params, from, group, order };
  };

  // Validate group/sort keys even when the statement does not use them.
  const selected = spec.select.map((key) => describe(property(type, key)));

  const pageParts = build(true, true);
  const { params } = pageParts;
  const valueIds = selected.filter((c) => c.source === "custom" && c.kind !== "relation").map((c) => c.id);
  const relationIds = selected.filter((c) => c.kind === "relation").map((c) => c.id);
  const props = valueIds.length
    ? `(select coalesce(jsonb_object_agg(pv.property_id, jsonb_build_array(pv.value_text, pv.value_number, pv.value_date, pv.value_bool, pv.value_json)), '{}'::jsonb)` +
      ` from wos_spike.property_value pv where pv.object_id = p.id and pv.property_id = any(${params.add(valueIds, "uuid[]")}))`
    : `'{}'::jsonb`;
  const rels = relationIds.length
    ? `(select coalesce(jsonb_object_agg(x.property_id, x.items), '{}'::jsonb) from (` +
      `select rr.property_id, jsonb_agg(jsonb_build_object('id', rt.id, 'title', rt.title) order by rt.title, rt.id) as items` +
      ` from wos_spike.object_relation rr join wos_spike.object rt on rt.id = rr.to_id` +
      ` where rr.from_id = p.id and rr.property_id = any(${params.add(relationIds, "uuid[]")}) and rt.archived_at is null` +
      ` group by rr.property_id) x)`
    : `'{}'::jsonb`;
  const orderBy = pageParts.order.join(", ");
  const page: CompiledQuery = {
    text:
      `select p.id, p.title, p.space_id, p.owner_id, p.created_at, p.updated_at, p.group_key, ${props} as props, ${rels} as relations` +
      ` from (select o.id, o.title, o.space_id, o.owner_id, o.created_at, o.updated_at, ${pageParts.group ? pageParts.group.expr : "null::text"} as group_key,` +
      ` row_number() over (order by ${orderBy}) as ord ${pageParts.from}` +
      ` order by ${orderBy} limit ${params.add(spec.limit, "numeric")}::int offset ${params.add(spec.offset, "numeric")}::int) p` +
      ` order by p.ord`,
    values: params.values,
  };

  const countParts = build(false, false);
  const count: CompiledQuery = {
    text: `select count(*)::int as total ${countParts.from}`,
    values: countParts.params.values,
  };

  let groups: CompiledQuery | undefined;
  if (spec.groupBy) {
    const g = build(false, true);
    groups = {
      text: `select ${g.group!.expr} as group_key, count(*)::int as total ${g.from} group by 1, ${g.group!.order} order by ${g.group!.order} asc nulls last`,
      values: g.params.values,
    };
  }

  // Sort keys are validated by build(true, ...) above.
  return {
    spec,
    page,
    count,
    groups,
    columns: selected,
    groupBy: spec.groupBy ? describe(property(type, spec.groupBy.property)) : undefined,
  };
}
