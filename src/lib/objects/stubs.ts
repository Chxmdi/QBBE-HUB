import { addCalendarDays, calendarDateInZone, DEFAULT_TIME_ZONE, startOfDayInstant } from "@/lib/time";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  FilterNode,
  FilterScalar,
  FilterValue,
  PropertyFilter,
  PropertyKind,
  PropertyPath,
  PropertyValue,
  QueryResult,
  QueryRow,
  QuerySpec,
  RunQuery,
  Uuid,
} from "./contracts";

/**
 * The last stand-in for the contracts in ./contracts.ts (W0-3, epic #199).
 *
 * `query` answers task queries over the existing task table until every call
 * site uses the query engine (M8a, integration I2); `taskSystemProperties`
 * is the task's column-to-property map it and the layouts share. The other
 * stand-ins this file held are gone, replaced by the real modules:
 *   can             src/lib/objects/can.ts (SQL app.can, M10c)
 *   actions / undo  src/features/objects/actions/registry.ts (M13)
 *   events          object_event written from triggers (M9a); the feed row
 *                   by src/lib/objects/activity-feed.ts
 *   invertChanges   src/lib/objects/changes.ts
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// query: tasks only, over the existing task table and its RLS
// ---------------------------------------------------------------------------

export class QueryNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryNotSupportedError";
  }
}

interface TaskProperty {
  column: string;
  kind: PropertyKind;
  /** `date` columns hold calendar dates; `instant` columns hold timestamptz. */
  time?: "date" | "instant";
  relationType?: string;
}

/** The task's native columns as system properties (plan A2). */
export const taskSystemProperties: Record<string, TaskProperty> = {
  title: { column: "title", kind: "text" },
  status: { column: "status", kind: "status" },
  priority: { column: "priority", kind: "select" },
  assignee: { column: "assignee_id", kind: "person" },
  requester: { column: "requester_id", kind: "person" },
  reviewer: { column: "reviewer_id", kind: "person" },
  start: { column: "start_at", kind: "date", time: "date" },
  due: { column: "due_at", kind: "date", time: "date" },
  estimate: { column: "estimate_hours", kind: "number" },
  project: { column: "project_id", kind: "relation", relationType: "project" },
  program: { column: "program_id", kind: "relation", relationType: "program" },
  completed_time: { column: "completed_at", kind: "date", time: "instant" },
  created_by: { column: "created_by", kind: "created_by" },
  created_time: { column: "created_at", kind: "created_time", time: "instant" },
  edited_time: { column: "updated_at", kind: "edited_time", time: "instant" },
};

export interface QueryContext {
  /** The signed-in person, for `{ relative: "me" }`. */
  userId: Uuid;
  timeZone?: string;
  now?: () => Date;
}

type Resolved = { point: FilterScalar | FilterScalar[] } | { from: string; to: string };

function taskProperty(path: PropertyPath): TaskProperty & { key: string } {
  if (typeof path !== "string") {
    throw new QueryNotSupportedError("Relation traversal arrives with the query engine (M8a).");
  }
  const property = taskSystemProperties[path];
  if (!property) throw new QueryNotSupportedError(`Tasks have no property "${path}".`);
  return { ...property, key: path };
}

function isRelative(value: FilterValue | undefined): value is Exclude<FilterValue, FilterScalar | FilterScalar[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Relative values become dates in the organization's zone, or the viewer's id. */
export function resolveValue(
  value: FilterValue | undefined,
  property: TaskProperty,
  context: QueryContext,
): Resolved {
  if (!isRelative(value)) return { point: value ?? null };
  if (value.relative === "me") return { point: context.userId };
  if (!property.time) {
    throw new QueryNotSupportedError(`"${value.relative}" only applies to date properties.`);
  }
  const zone = context.timeZone ?? DEFAULT_TIME_ZONE;
  const today = calendarDateInZone((context.now ?? (() => new Date()))(), zone);
  if (!today) throw new QueryNotSupportedError("Could not work out today's date.");
  let from = today;
  let to = addCalendarDays(today, 1)!;
  if (value.relative === "this_week") {
    // Monday to Monday, the week as the Hub's calendar shows it.
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    from = addCalendarDays(today, -((weekday + 6) % 7))!;
    to = addCalendarDays(from, 7)!;
  } else if (value.relative === "days_from_today") {
    from = addCalendarDays(today, value.days)!;
    to = addCalendarDays(from, 1)!;
  }
  if (property.time === "instant") {
    return {
      from: startOfDayInstant(from, zone)!.toISOString(),
      to: startOfDayInstant(to, zone)!.toISOString(),
    };
  }
  return value.relative === "this_week" ? { from, to } : { point: from };
}

/** A value inside a PostgREST logic tree, quoted so commas and parentheses stay literal. */
function literal(value: FilterScalar): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function leaf(filter: PropertyFilter, context: QueryContext): string {
  const property = taskProperty(filter.property);
  const column = property.column;
  if (filter.op === "is_empty") return `${column}.is.null`;
  if (filter.op === "is_not_empty") return `${column}.not.is.null`;

  const resolved = resolveValue(filter.value, property, context);
  if ("from" in resolved) {
    const from = literal(resolved.from);
    const to = literal(resolved.to);
    switch (filter.op) {
      case "eq":
        return `and(${column}.gte.${from},${column}.lt.${to})`;
      case "neq":
        return `or(${column}.lt.${from},${column}.gte.${to})`;
      case "lt":
        return `${column}.lt.${from}`;
      case "lte":
        return `${column}.lt.${to}`;
      case "gt":
        return `${column}.gte.${to}`;
      case "gte":
        return `${column}.gte.${from}`;
      default:
        throw new QueryNotSupportedError(`"${filter.op}" does not take a date range.`);
    }
  }

  const value = resolved.point;
  if (filter.op === "in") {
    if (!Array.isArray(value)) throw new QueryNotSupportedError('"in" needs a list.');
    return `${column}.in.(${value.map(literal).join(",")})`;
  }
  if (Array.isArray(value)) throw new QueryNotSupportedError(`"${filter.op}" needs one value.`);
  if (filter.op === "contains") {
    if (typeof value !== "string") throw new QueryNotSupportedError('"contains" needs text.');
    return `${column}.ilike.${literal(`*${value}*`)}`;
  }
  if (value === null) {
    if (filter.op === "eq") return `${column}.is.null`;
    if (filter.op === "neq") return `${column}.not.is.null`;
    throw new QueryNotSupportedError(`"${filter.op}" cannot compare with nothing.`);
  }
  return `${column}.${filter.op}.${literal(value)}`;
}

/** The whole filter as one PostgREST logic-tree condition. */
export function serializeFilter(node: FilterNode, context: QueryContext): string {
  if ("and" in node || "or" in node) {
    const [joiner, children] = "and" in node ? ["and", node.and] : ["or", node.or];
    if (children.length === 0) throw new QueryNotSupportedError(`An empty "${joiner}" group matches nothing useful.`);
    return `${joiner}(${children.map((child) => serializeFilter(child, context)).join(",")})`;
  }
  return leaf(node, context);
}

function toValue(property: TaskProperty, raw: unknown): PropertyValue | null {
  if (raw === null || raw === undefined) return null;
  switch (property.kind) {
    case "person":
    case "created_by":
      return { kind: property.kind, value: [String(raw)] };
    case "relation":
      return { kind: "relation", value: [{ id: String(raw), type: property.relationType! }] };
    case "number":
      return { kind: "number", value: Number(raw) };
    case "date":
    case "created_time":
    case "edited_time":
      return { kind: property.kind, value: String(raw) };
    default:
      return { kind: property.kind as "text", value: String(raw) };
  }
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Runs a query spec for tasks through the caller's own client, so the task
 * table's RLS decides what comes back. Archived tasks are left out, as on
 * every task screen today.
 */
export function createTaskQueryStub(client: Pick<Client, "from">, context: QueryContext): RunQuery {
  return async (spec: QuerySpec): Promise<QueryResult> => {
    if (spec.version !== 1) throw new QueryNotSupportedError(`Unknown query spec version ${spec.version}.`);
    if (spec.types.length !== 1 || spec.types[0] !== "task") {
      throw new QueryNotSupportedError("The stand-in answers task queries only.");
    }
    if (spec.spaceIds?.length || spec.parentObjectId) {
      throw new QueryNotSupportedError("Spaces and nesting arrive with M10a and M4a.");
    }

    const keys = [...new Set(["title", ...(spec.properties ?? Object.keys(taskSystemProperties))])];
    const groupKey = spec.groupBy === undefined ? null : taskProperty(spec.groupBy).key;
    if (groupKey && !keys.includes(groupKey)) keys.push(groupKey);
    const columns = keys.map((key) => taskProperty(key).column);

    const limit = Math.min(Math.max(spec.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = spec.cursor ? Number.parseInt(spec.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new QueryNotSupportedError("Invalid cursor.");

    let query = client
      .from("task")
      .select(["id", ...new Set(columns)].join(","))
      .is("archived_at", null);
    if (spec.filter) query = query.or(`and(${serializeFilter(spec.filter, context)})`);
    const sorts = spec.sorts?.length ? spec.sorts : [{ property: "created_time", direction: "desc" as const }];
    for (const sort of sorts) {
      query = query.order(taskProperty(sort.property).column, {
        ascending: sort.direction === "asc",
        nullsFirst: false,
      });
    }
    query = query.order("id", { ascending: true });

    const { data, error } = await query.range(offset, offset + limit);
    if (error) throw new Error(error.message);
    const records = (data ?? []) as unknown as Record<string, unknown>[];

    const rows: QueryRow[] = records.slice(0, limit).map((record) => ({
      ref: { id: String(record.id), type: "task" },
      title: String(record.title ?? ""),
      values: Object.fromEntries(
        keys.map((key) => {
          const property = taskSystemProperties[key];
          return [key, toValue(property, record[property.column])];
        }),
      ),
    }));

    const result: QueryResult = {
      rows,
      nextCursor: records.length > limit ? String(offset + limit) : null,
    };
    if (groupKey) {
      const groups = new Map<string | null, Uuid[]>();
      for (const row of rows) {
        const raw = records.find((record) => record.id === row.ref.id)?.[taskSystemProperties[groupKey].column];
        const key = raw === null || raw === undefined ? null : String(raw);
        groups.set(key, [...(groups.get(key) ?? []), row.ref.id]);
      }
      result.groups = [...groups].map(([key, rowIds]) => ({ key, rowIds }));
    }
    return result;
  };
}
