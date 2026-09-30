/**
 * Where a task came from (M7b). The list matches the `task_source_type_check`
 * constraint in 20261105010001_task_source.sql; a test keeps them in step.
 */
export const TASK_SOURCE_TYPES = [
  "manual",
  "meeting",
  "document",
  "comment",
  "project",
  "message",
  "workflow",
  "contact",
  "template",
  "recurrence",
  "capture",
  "command",
] as const;

export type TaskSourceType = (typeof TASK_SOURCE_TYPES)[number];

export interface TaskSource {
  type: TaskSourceType;
  /** The row the task came from. Null for `manual` and `command`. */
  id: string | null;
}

export function isTaskSourceType(value: unknown): value is TaskSourceType {
  return typeof value === "string" && (TASK_SOURCE_TYPES as readonly string[]).includes(value);
}

/** Sources that never name a row. */
const ROWLESS: ReadonlySet<TaskSourceType> = new Set(["manual", "command"]);

/** Sources that must name a row: a task "from a meeting" says which meeting. */
export function sourceNeedsId(type: TaskSourceType): boolean {
  return !ROWLESS.has(type);
}

/**
 * The table holding each source's row, read through the caller's own RLS to
 * prove the caller can see it before a task claims to come from it, and again
 * to label the link back. `title` is the column shown in the link.
 *
 * `comment` names record_comment; task comments are reached through their
 * task, which the link already opens. `capture` names the capture inbox item
 * (M18), which only its owner can read.
 */
export const SOURCE_TABLES: Partial<
  Record<TaskSourceType, { table: string; title: string; extra?: string[] }>
> = {
  meeting: { table: "meeting", title: "title" },
  document: { table: "document", title: "title" },
  comment: { table: "record_comment", title: "body", extra: ["parent_type", "parent_id"] },
  project: { table: "project", title: "name" },
  message: { table: "message", title: "body", extra: ["channel_id"] },
  workflow: { table: "workflow_rule", title: "name" },
  contact: { table: "crm_follow_up", title: "title", extra: ["crm_organization_id"] },
  template: { table: "record_template", title: "name" },
  recurrence: { table: "task", title: "title" },
  capture: { table: "capture_item", title: "title" },
};

/** Record-comment parents that have a page of their own. */
const COMMENT_PARENT_ROUTES: Partial<Record<string, (id: string) => string>> = {
  project: (id) => `/projects/${id}`,
  task: (id) => `/my-work?task=${id}`,
  meeting: (id) => `/meetings/${id}`,
  event: (id) => `/events/${id}`,
  organization: (id) => `/crm/${id}`,
};

/**
 * Where the link back goes, from the source row as the caller can read it.
 * Null when the source has no page of its own.
 */
export function sourceHref(
  type: TaskSourceType,
  id: string | null,
  row: Record<string, unknown> = {},
): string | null {
  if (!id) return null;
  switch (type) {
    case "meeting":
      return `/meetings/${id}`;
    case "document":
      return `/documents/${id}`;
    case "project":
      return `/projects/${id}`;
    case "message":
      return typeof row.channel_id === "string" ? `/channels/${row.channel_id}?message=${id}` : null;
    case "contact":
      return typeof row.crm_organization_id === "string" ? `/crm/${row.crm_organization_id}` : null;
    case "recurrence":
      return `/my-work?task=${id}`;
    case "comment": {
      const route = COMMENT_PARENT_ROUTES[String(row.parent_type)];
      return route && typeof row.parent_id === "string" ? route(row.parent_id) : null;
    }
    case "workflow":
      return "/admin";
    case "template":
      return "/admin/templates";
    case "capture":
      return "/capture";
    default:
      return null;
  }
}

/** One line of a source's text for a link label: first line, trimmed to 80. */
export function sourceTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.split("\n")[0]?.trim() ?? "";
  if (!line) return null;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
