import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a comment lives, as a page a person can open.
 *
 * A mention email links to `/search?comment=<id>`, which resolves here, so a
 * link already sitting in somebody's inbox keeps working if a record's page
 * moves. Records without a page of their own open their parent's page.
 */
export interface CommentParent {
  type: string;
  id: string;
  projectId?: string | null;
  meetingId?: string | null;
  crmOrganizationId?: string | null;
}

export function commentParentPath(parent: CommentParent): string | null {
  switch (parent.type) {
    case "project":
      return `/projects/${parent.id}`;
    case "task":
      return `/my-work?task=${parent.id}`;
    case "event":
      return `/events/${parent.id}`;
    case "meeting":
      return `/meetings/${parent.id}`;
    case "organization":
      return `/crm/${parent.id}`;
    case "milestone":
    case "update":
      return parent.projectId ? `/projects/${parent.projectId}` : null;
    case "risk":
    case "issue":
      return parent.projectId
        ? `/projects/${parent.projectId}?tab=risks&${parent.type}=${parent.id}`
        : null;
    case "agenda_item":
      return parent.meetingId ? `/meetings/${parent.meetingId}` : null;
    case "contact":
      return parent.crmOrganizationId ? `/crm/${parent.crmOrganizationId}` : null;
    case "opportunity":
      return parent.crmOrganizationId
        ? `/crm/${parent.crmOrganizationId}?tab=opportunities&opportunity=${parent.id}`
        : null;
    default:
      return null;
  }
}

/** The table and column that hold a parent's own parent, for types without a page. */
const PARENT_LOOKUP: Record<string, { table: string; column: "project_id" | "meeting_id" | "crm_organization_id" }> = {
  milestone: { table: "milestone", column: "project_id" },
  update: { table: "project_status_update", column: "project_id" },
  risk: { table: "risk", column: "project_id" },
  issue: { table: "issue", column: "project_id" },
  agenda_item: { table: "agenda_item", column: "meeting_id" },
  contact: { table: "crm_contact", column: "crm_organization_id" },
  opportunity: { table: "opportunity", column: "crm_organization_id" },
};

/**
 * Resolves a comment id to its page, reading through the caller's own client
 * so row-level security decides: a comment the person cannot see resolves to
 * null, and the caller shows nothing about it.
 */
export async function resolveCommentPath(db: SupabaseClient, commentId: string): Promise<string | null> {
  const { data: comment } = await db
    .from("record_comment")
    .select("parent_type, parent_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return null;

  const parent: CommentParent = {
    type: comment.parent_type as string,
    id: comment.parent_id as string,
  };
  const lookup = PARENT_LOOKUP[parent.type];
  if (lookup) {
    const { data: row } = await db
      .from(lookup.table)
      .select(lookup.column)
      .eq("id", parent.id)
      .maybeSingle();
    if (!row) return null;
    const value = (row as Record<string, unknown>)[lookup.column];
    const key = lookup.column === "project_id"
      ? "projectId"
      : lookup.column === "meeting_id" ? "meetingId" : "crmOrganizationId";
    parent[key] = typeof value === "string" ? value : null;
  }
  return commentParentPath(parent);
}
