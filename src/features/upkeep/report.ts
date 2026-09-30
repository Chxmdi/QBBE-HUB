/**
 * Workspace upkeep (V3-2): the shapes the report functions return and the
 * small rules the screen applies. The reports themselves are SQL functions
 * that run as the viewer (migration 20261106110500).
 */

export const STALE_THRESHOLDS = [90, 180, 365] as const;
export type StaleThreshold = (typeof STALE_THRESHOLDS)[number];

export function staleThreshold(raw: string | undefined): StaleThreshold {
  const n = Number(raw);
  return (STALE_THRESHOLDS as readonly number[]).includes(n) ? (n as StaleThreshold) : 180;
}

export interface StaleRow {
  object_type: "document" | "page";
  object_id: string;
  title: string;
  owner_id: string | null;
  owner_name: string | null;
  last_touched: string;
  days_idle: number;
}

export interface IssueRow {
  issue: string;
  object_type?: string;
  object_id: string;
  title: string;
  detail: string | null;
}

export interface DuplicateRow {
  object_type: "task" | "project" | "document";
  match_key: string;
  object_ids: string[];
  titles: string[];
}

/** Where a reported record opens in the Hub today. */
export function hrefFor(objectType: string | undefined, id: string): string | null {
  switch (objectType) {
    case "task":
      return `/my-work?task=${id}`;
    case "project":
      return `/projects/${id}`;
    case "document":
      return `/documents/${id}`;
    default:
      return null;
  }
}

/** The kind of record an issue row is about, for its label. */
export function kindOf(row: IssueRow): "task" | "project" | "document" | "page" | "type" | "view" {
  if (row.issue === "type_without_objects") return "type";
  if (row.issue === "view_for_missing_project") return "view";
  return (row.object_type as "task" | "project" | "document" | "page") ?? "document";
}

export function total(parts: { length: number }[]): number {
  return parts.reduce((sum, part) => sum + part.length, 0);
}
