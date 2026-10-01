import type { QueryRow } from "@/lib/objects/contracts";

/**
 * Where a row from the query engine opens in the Hub, by type. The row needs
 * the properties the link reads (a decision's meeting and project, an
 * activity's source and project) in its `values`; when a target is hidden
 * from the viewer, the engine shows nothing for it and the link falls back to
 * the list the viewer can open.
 */

function related(row: QueryRow, key: string): string | null {
  const value = row.values[key];
  return value?.kind === "relation" ? (value.value[0]?.id ?? null) : null;
}

function text(row: QueryRow, key: string): string | null {
  const value = row.values[key];
  return value && typeof value.value === "string" ? value.value : null;
}

export function objectHref(row: QueryRow): string {
  const project = (id: string | null) => (id ? `/projects/${id}` : "/projects");
  switch (row.ref.type) {
    case "task":
      return `/my-work?task=${row.ref.id}`;
    case "project":
      return `/projects/${row.ref.id}`;
    case "document":
      return `/documents/${row.ref.id}`;
    case "meeting":
      return `/meetings/${row.ref.id}`;
    case "decision": {
      const meeting = related(row, "meeting");
      return meeting ? `/meetings/${meeting}` : project(related(row, "project"));
    }
    case "activity": {
      const source = text(row, "source_id");
      return text(row, "source_type") === "task" && source ? `/my-work?task=${source}` : project(related(row, "project"));
    }
    default:
      return project(related(row, "project"));
  }
}
