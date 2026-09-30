import { addCalendarDays, calendarDateInZone, DEFAULT_TIME_ZONE, startOfDayInstant } from "@/lib/time";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  workspaceCapabilities,
  type ActionContext,
  type ActionDefinition,
  type ActionRegistry,
  type ActionResult,
  type Can,
  type Change,
  type ChangeSet,
  type FilterNode,
  type FilterScalar,
  type FilterValue,
  type PropertyFilter,
  type PropertyKind,
  type PropertyPath,
  type PropertyValue,
  type QueryResult,
  type QueryRow,
  type QuerySpec,
  type RunQuery,
  type Uuid,
  type WriteObjectEvent,
} from "./contracts";

/**
 * Stand-ins for the contracts in ./contracts.ts (W0-3, epic #199).
 *
 * Each returns today's behaviour through the new interface, so other streams
 * can build on the interface now. They are replaced, not extended:
 *   can             by the real app.can with cached grants (M10c)
 *   query           by the query engine over every type (M8a)
 *   actions / undo  by the persisted action registry (M13)
 *   events          by object_event written from triggers (M9a)
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// can
// ---------------------------------------------------------------------------

/**
 * Asks SQL `public.can`, which for tasks and projects calls the existing
 * has_task_capability / has_project_capability. One source of truth: the
 * capability mapping lives in the migration, not here.
 */
export function createCanStub(client: Pick<Client, "rpc">): Can {
  return async (objectId, capability) => {
    if (!(workspaceCapabilities as readonly string[]).includes(capability)) return false;
    const { data, error } = await client.rpc("can", {
      object_id: objectId,
      capability,
    });
    return !error && data === true;
  };
}

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

// ---------------------------------------------------------------------------
// actions and undo, kept in memory until M13 persists change sets
// ---------------------------------------------------------------------------

/** The changes that reverse `changes`, in reverse order. */
export function invertChanges(changes: Change[]): Change[] {
  return [...changes].reverse().map((change): Change => {
    switch (change.kind) {
      case "create":
        return { kind: "delete", object: change.object, values: change.values };
      case "delete":
        return { kind: "create", object: change.object, values: change.values };
      case "update":
        return { ...change, before: change.after, after: change.before };
      case "link":
        return { kind: "unlink", relation: change.relation };
      case "unlink":
        return { kind: "link", relation: change.relation };
    }
  });
}

function touchedObjects(changes: Change[]): Uuid[] {
  return [
    ...new Set(
      changes.flatMap((change) =>
        "object" in change ? [change.object.id] : [change.relation.from.id, change.relation.to.id],
      ),
    ),
  ];
}

export interface ActionRegistryOptions {
  /** Writes changes to storage; used by undo. */
  apply: (changes: Change[], context: ActionContext) => Promise<void>;
  now?: () => Date;
  newId?: () => Uuid;
}

export function createActionRegistryStub(options: ActionRegistryOptions): ActionRegistry {
  const actions = new Map<string, ActionDefinition>();
  const changeSets = new Map<Uuid, ChangeSet>();
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());

  const allowed = async (ids: Uuid[], action: ActionDefinition, context: ActionContext) => {
    for (const id of ids) {
      if (!(await context.can(id, action.capability))) return false;
    }
    return true;
  };

  const record = (actionKey: string, changes: Change[], context: ActionContext, undoOf: Uuid | null) => {
    const changeSet: ChangeSet = {
      id: newId(),
      actionKey,
      actor: context.actor,
      createdAt: now().toISOString(),
      changes,
      undoOf,
    };
    changeSets.set(changeSet.id, changeSet);
    return changeSet;
  };

  return {
    register(action) {
      if (actions.has(action.key)) throw new Error(`Action "${action.key}" is already registered.`);
      actions.set(action.key, action as ActionDefinition);
    },
    get: (key) => actions.get(key),
    async run(key, input, context): Promise<ActionResult> {
      const action = actions.get(key);
      if (!action) return { ok: false, reason: "unknown_action" };
      if (!(await allowed(action.targets(input), action, context))) return { ok: false, reason: "forbidden" };
      try {
        const changes = await action.run(context, input);
        return { ok: true, changeSet: record(key, changes, context, null) };
      } catch (error) {
        return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
    async undo(changeSetId, context): Promise<ActionResult> {
      const original = changeSets.get(changeSetId);
      const action = original && actions.get(original.actionKey);
      if (!original || !action) return { ok: false, reason: "unknown_action" };
      // Undo needs the same capability as the action, on everything it touched.
      if (!(await allowed(touchedObjects(original.changes), action, context))) {
        return { ok: false, reason: "forbidden" };
      }
      const inverse = invertChanges(original.changes);
      try {
        await options.apply(inverse, context);
      } catch (error) {
        return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, changeSet: record(original.actionKey, inverse, context, original.id) };
    },
  };
}

// ---------------------------------------------------------------------------
// events: written to today's activity feed until object_event exists (M9a)
// ---------------------------------------------------------------------------

export function createEventWriterStub(client: Pick<Client, "from">): WriteObjectEvent {
  return async (event) => {
    const { error } = await client.from("activity_event").insert({
      organization_id: event.organizationId,
      // activity_event.actor_id references a person; other identities go in metadata.
      actor_id: event.actor.kind === "person" ? event.actor.id : null,
      verb: event.verb,
      source_type: event.object.type,
      source_id: event.object.id,
      project_id: event.projectId ?? null,
      program_id: event.programId ?? null,
      summary: event.summary,
      metadata: {
        actor: event.actor,
        changes: event.changes,
        change_set_id: event.changeSetId ?? null,
      },
    });
    if (error) throw new Error(error.message);
  };
}
