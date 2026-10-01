import type { QueryRow, QuerySpec } from "@/lib/objects/contracts";
import { findProperty, localized, type LensCatalog } from "@/lib/query/catalog";
import { objectHref } from "@/lib/query/links";

/**
 * Query blocks (M5) store a QuerySpec (src/lib/objects/contracts.ts) and show
 * its rows as a list lens. The block offers these presets and runs them, and
 * any stored spec, through the lens query engine (M8a) as the viewer, so a
 * block can list tasks, decisions or meetings alike.
 */

export const queryPresets = ["my_open", "due_this_week", "overdue", "recent_decisions", "upcoming_meetings"] as const;
export type QueryPreset = (typeof queryPresets)[number];

const OPEN = [
  { property: "status", op: "neq" as const, value: "completed" },
  { property: "status", op: "neq" as const, value: "cancelled" },
];

export function presetSpec(preset: QueryPreset): QuerySpec {
  const tasks = {
    version: 1 as const,
    types: ["task"],
    properties: ["status", "due", "assignee"],
    sorts: [{ property: "due", direction: "asc" as const }],
    limit: 10,
  };
  switch (preset) {
    case "my_open":
      return { ...tasks, filter: { and: [{ property: "assignee", op: "eq", value: { relative: "me" } }, ...OPEN] } };
    case "due_this_week":
      return { ...tasks, filter: { and: [{ property: "due", op: "eq", value: { relative: "this_week" } }, ...OPEN] } };
    case "overdue":
      return { ...tasks, filter: { and: [{ property: "due", op: "lt", value: { relative: "today" } }, ...OPEN] } };
    case "recent_decisions":
      return {
        version: 1,
        types: ["decision"],
        properties: ["decided_time", "meeting", "project"],
        sorts: [{ property: "decided_time", direction: "desc" }],
        limit: 10,
      };
    case "upcoming_meetings":
      return {
        version: 1,
        types: ["meeting"],
        filter: { and: [{ property: "starts", op: "gte", value: { relative: "today" } }, { property: "status", op: "neq", value: "cancelled" }] },
        properties: ["starts", "status", "project"],
        sorts: [{ property: "starts", direction: "asc" }],
        limit: 10,
      };
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

export type QueryBlockDateLabel = "due" | "decided" | "starts";

/** One row as the query block shows it: a link, a status badge and one date. */
export interface QueryBlockRow {
  id: string;
  type: string;
  title: string;
  href: string;
  /** A task's status key; the block labels it with the task vocabulary. */
  status: string | null;
  /** Any other type's status, already labelled from the engine's catalog. */
  statusLabel: string | null;
  date: string | null;
  dateLabel: QueryBlockDateLabel | null;
}

const DATE_PROPERTY: Record<string, [string, QueryBlockDateLabel]> = {
  task: ["due", "due"],
  milestone: ["due", "due"],
  decision: ["decided_time", "decided"],
  meeting: ["starts", "starts"],
};

export function toQueryBlockRow(row: QueryRow, catalog: LensCatalog, locale: string): QueryBlockRow {
  const type = row.ref.type;
  const text = (key: string) => {
    const value = row.values[key];
    return value && typeof value.value === "string" ? value.value : null;
  };
  const status = text("status");
  const choice = status ? findProperty(catalog, type, "status")?.choices?.find((c) => c.key === status) : undefined;
  const [dateKey, dateLabel] = DATE_PROPERTY[type] ?? ["due", "due"];
  const date = text(dateKey);
  return {
    id: row.ref.id,
    type,
    title: row.title,
    href: objectHref(row),
    status: type === "task" ? status : null,
    statusLabel: type !== "task" && status ? (choice ? localized(choice.label, locale) : status) : null,
    date,
    dateLabel: date ? dateLabel : null,
  };
}
