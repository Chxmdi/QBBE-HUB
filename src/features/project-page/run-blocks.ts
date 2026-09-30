import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilterNode, PropertyFilter, PropertyValue, QueryResult, QueryRow, QuerySpec } from "@/lib/objects/contracts";
import { QueryNotSupportedError, createTaskQueryStub, type QueryContext } from "@/lib/objects/stubs";

/**
 * Runs a project block's query spec until the query engine (M8a) does.
 * Tasks go through the agreed task stand-in (stubs.ts). The other types go
 * through NATIVE_TYPES below, which understands the part of the spec the
 * project page uses: an `and` of property filters (eq, neq, in, lt, lte, gt,
 * gte, is_empty, is_not_empty on scalar values), sorts and a limit. Anything
 * else is refused with QueryNotSupportedError rather than half-answered.
 * Every read goes through the viewer's own client, so RLS decides the rows.
 */

interface NativeType {
  table: string;
  title: string;
  properties: Record<string, { column: string; kind: PropertyValue["kind"] }>;
  /** Link for a row. */
  href: (row: Record<string, unknown>) => string;
}

export const NATIVE_TYPES: Record<string, NativeType> = {
  decision: {
    table: "decision",
    title: "title",
    properties: {
      project: { column: "project_id", kind: "text" },
      meeting: { column: "meeting_id", kind: "text" },
      decided_time: { column: "decided_at", kind: "date" },
    },
    href: (row) => (row.meeting_id ? `/meetings/${row.meeting_id}` : `/projects/${row.project_id}`),
  },
  milestone: {
    table: "milestone",
    title: "name",
    properties: {
      project: { column: "project_id", kind: "text" },
      due: { column: "due_date", kind: "date" },
      status: { column: "status", kind: "status" },
      completed_time: { column: "completed_at", kind: "date" },
    },
    href: (row) => `/projects/${row.project_id}`,
  },
  document: {
    table: "document",
    title: "title",
    properties: {
      project: { column: "project_id", kind: "text" },
      kind: { column: "kind", kind: "select" },
      edited_time: { column: "updated_at", kind: "edited_time" },
      archived_time: { column: "archived_at", kind: "date" },
    },
    href: (row) => `/documents/${row.id}`,
  },
  activity: {
    table: "activity_event",
    title: "summary",
    properties: {
      project: { column: "project_id", kind: "text" },
      created_time: { column: "created_at", kind: "created_time" },
      source_type: { column: "source_type", kind: "text" },
      source_id: { column: "source_id", kind: "text" },
    },
    href: (row) =>
      row.source_type === "task" ? `/my-work?task=${row.source_id}` : `/projects/${row.project_id}`,
  },
  risk: {
    table: "risk",
    title: "title",
    properties: {
      project: { column: "project_id", kind: "text" },
      status: { column: "status", kind: "status" },
      likelihood: { column: "likelihood", kind: "select" },
      impact: { column: "impact", kind: "select" },
      score: { column: "score", kind: "number" },
    },
    href: (row) => `/projects/${row.project_id}`,
  },
};

export interface BlockRow extends QueryRow {
  href: string;
}

function leaves(node: FilterNode | undefined): PropertyFilter[] {
  if (!node) return [];
  if ("or" in node) throw new QueryNotSupportedError("Only `and` filters until the query engine (M8a).");
  if ("and" in node) return node.and.flatMap(leaves);
  return [node];
}

function column(type: NativeType, property: PropertyFilter["property"]): string {
  if (typeof property !== "string") throw new QueryNotSupportedError("Relation traversal arrives with M8a.");
  const found = type.properties[property];
  if (!found) throw new QueryNotSupportedError(`No property "${property}".`);
  return found.column;
}

type Builder = {
  eq: (column: string, value: unknown) => Builder;
  neq: (column: string, value: unknown) => Builder;
  in: (column: string, values: unknown[]) => Builder;
  lt: (column: string, value: unknown) => Builder;
  lte: (column: string, value: unknown) => Builder;
  gt: (column: string, value: unknown) => Builder;
  gte: (column: string, value: unknown) => Builder;
  is: (column: string, value: null) => Builder;
  not: (column: string, operator: string, value: null) => Builder;
  order: (column: string, options: { ascending: boolean; nullsFirst: boolean }) => Builder;
  limit: (count: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function runNativeSpec(db: Pick<SupabaseClient, "from">, spec: QuerySpec): Promise<BlockRow[]> {
  if (spec.types.length !== 1) throw new QueryNotSupportedError("One type per block.");
  const type = NATIVE_TYPES[spec.types[0]];
  if (!type) throw new QueryNotSupportedError(`No reader for "${spec.types[0]}".`);
  const keys = spec.properties ?? Object.keys(type.properties);
  const columns = new Set(["id", type.title, ...Object.values(type.properties).map((property) => property.column)]);

  let query = db.from(type.table).select([...columns].join(",")) as unknown as Builder;
  for (const filter of leaves(spec.filter)) {
    const target = column(type, filter.property);
    const value = filter.value;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      throw new QueryNotSupportedError("Relative values arrive with M8a on this type.");
    }
    switch (filter.op) {
      case "is_empty":
        query = query.is(target, null);
        break;
      case "is_not_empty":
        query = query.not(target, "is", null);
        break;
      case "in":
        if (!Array.isArray(value)) throw new QueryNotSupportedError('"in" needs a list.');
        query = query.in(target, value);
        break;
      case "eq":
      case "neq":
      case "lt":
      case "lte":
      case "gt":
      case "gte":
        if (Array.isArray(value)) throw new QueryNotSupportedError(`"${filter.op}" needs one value.`);
        query = query[filter.op](target, value);
        break;
      default:
        throw new QueryNotSupportedError(`"${filter.op}" arrives with M8a on this type.`);
    }
  }
  for (const sort of spec.sorts ?? []) {
    query = query.order(column(type, sort.property), { ascending: sort.direction === "asc", nullsFirst: false });
  }
  const { data, error } = await query.limit(Math.min(Math.max(spec.limit ?? 20, 1), 100));
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ref: { id: String(row.id), type: spec.types[0] },
    title: String(row[type.title] ?? ""),
    href: type.href(row),
    values: Object.fromEntries(
      keys.map((key) => {
        const property = type.properties[key];
        const raw = property ? row[property.column] : undefined;
        if (raw === null || raw === undefined) return [key, null];
        return [key, (property.kind === "number" ? { kind: "number", value: Number(raw) } : { kind: property.kind, value: String(raw) }) as PropertyValue];
      }),
    ),
  }));
}

/** Runs one block's spec: tasks through the task stand-in, everything else natively. */
export async function runBlockSpec(
  db: Pick<SupabaseClient, "from">,
  spec: QuerySpec,
  context: QueryContext,
): Promise<BlockRow[]> {
  if (spec.types.length === 1 && spec.types[0] === "task") {
    const result: QueryResult = await createTaskQueryStub(db as never, context)(spec);
    return result.rows.map((row) => ({ ...row, href: `/my-work?task=${row.ref.id}` }));
  }
  return runNativeSpec(db, spec);
}
