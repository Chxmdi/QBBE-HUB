import type { QuerySpec } from "@/lib/objects/contracts";

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
