import type { QuerySpec } from "@/lib/objects/contracts";
import type { ViewBlockProps } from "@/features/lenses/view-block/schema";

/**
 * Query blocks (M5) store a QuerySpec (src/lib/objects/contracts.ts) and show
 * its rows as a list lens. Until the lens query engine (S4, M8a) lands, the
 * block offers these presets and runs them through the task stand-in
 * (createTaskQueryStub); any stored spec keeps working when the real engine
 * replaces the stand-in.
 */

export const queryPresets = ["my_open", "due_this_week", "overdue"] as const;
export type QueryPreset = (typeof queryPresets)[number];

const OPEN = [
  { property: "status", op: "neq" as const, value: "completed" },
  { property: "status", op: "neq" as const, value: "cancelled" },
];

export function presetSpec(preset: QueryPreset): QuerySpec {
  const base = {
    version: 1 as const,
    types: ["task"],
    properties: ["status", "due", "assignee"],
    sorts: [{ property: "due", direction: "asc" as const }],
    limit: 10,
  };
  switch (preset) {
    case "my_open":
      return { ...base, filter: { and: [{ property: "assignee", op: "eq", value: { relative: "me" } }, ...OPEN] } };
    case "due_this_week":
      return { ...base, filter: { and: [{ property: "due", op: "eq", value: { relative: "this_week" } }, ...OPEN] } };
    case "overdue":
      return { ...base, filter: { and: [{ property: "due", op: "lt", value: { relative: "today" } }, ...OPEN] } };
  }
}

/** Open tasks: not completed, not cancelled, as the lens engine says it. */
const OPEN_V2 = { path: "status", op: "is_none_of", value: ["completed", "cancelled"] } as const;

/**
 * The same preset as a version 2 view block (U6), for the block's "Turn into
 * a view" action: the same tasks, as a list the person can then reshape
 * (layout, conditions, fields) from the block's settings.
 */
export function presetViewBlock(preset: QueryPreset): ViewBlockProps {
  const base = {
    version: 2 as const,
    source: { type: "task" },
    layout: "list" as const,
    sort: [{ path: "due", direction: "asc" as const }],
    fields: ["status", "due", "assignee"],
    pageFilters: { enabled: false, paths: [] },
    maxRows: 10,
  };
  switch (preset) {
    case "my_open":
      return { ...base, where: [{ path: "assignee", op: "contains", value: { relative: "me" } }, OPEN_V2] };
    case "due_this_week":
      return { ...base, where: [{ path: "due", op: "is", value: { relative: "this_week" } }, OPEN_V2] };
    case "overdue":
      return { ...base, where: [{ path: "due", op: "before", value: { relative: "today" } }, OPEN_V2] };
  }
}

/** A stored spec, if it is a well-formed version 1 spec; anything else is refused. */
export function parseStoredSpec(raw: unknown): QuerySpec | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const spec = value as Partial<QuerySpec>;
  if (spec.version !== 1 || !Array.isArray(spec.types) || spec.types.length === 0) return null;
  if (!spec.types.every((type) => typeof type === "string")) return null;
  return { ...(spec as QuerySpec), limit: Math.min(Math.max(spec.limit ?? 10, 1), 50) };
}
