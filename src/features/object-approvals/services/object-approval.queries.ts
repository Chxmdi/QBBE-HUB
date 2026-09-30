import { createSupabasePageClient } from "@/lib/supabase/page";
import type { ApprovableType, ApprovalItemStatus } from "../contract";

export interface ObjectApprovalRow {
  approvalItemId: string;
  title: string;
  status: ApprovalItemStatus;
  stepLabel: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  canOpen: boolean;
}

const TITLE_SOURCE: Record<ApprovableType, { table: string; column: string }> = {
  task: { table: "task", column: "title" },
  project: { table: "project", column: "name" },
  meeting: { table: "meeting", column: "title" },
  decision: { table: "decision", column: "title" },
};

/** Where the record itself lives in the app. */
export function recordHref(type: ApprovableType, id: string, projectId: string | null): string {
  switch (type) {
    case "task":
      return `/my-work?task=${id}`;
    case "project":
      return `/projects/${id}`;
    case "meeting":
      return `/meetings/${id}`;
    case "decision":
      return projectId ? `/projects/${projectId}?tab=risks` : "/";
  }
}

/**
 * The record (read under the viewer's own RLS, so an unreadable record is
 * null) and its approvals, through public.object_approvals. Page client: a
 * failed read reaches the error page rather than reading as "none".
 */
export async function getObjectApprovals(type: ApprovableType, id: string): Promise<{
  title: string;
  href: string;
  approvals: ObjectApprovalRow[];
} | null> {
  const supabase = await createSupabasePageClient();
  const source = TITLE_SOURCE[type];
  const columns = type === "decision" ? `id, ${source.column}, project_id` : `id, ${source.column}`;
  const { data: record } = await supabase.from(source.table).select(columns).eq("id", id).maybeSingle();
  if (!record) return null;
  const row = record as unknown as Record<string, string | null>;
  const { data } = await supabase
    .rpc("object_approvals", { p_object_type: type, p_object_id: id })
    .throwOnError();
  return {
    title: row[source.column] ?? "",
    href: recordHref(type, id, row.project_id ?? null),
    approvals: ((data ?? []) as {
      approval_item_id: string; title: string; status: ApprovalItemStatus; step_label: string | null;
      requested_by_name: string | null; requested_at: string; decided_at: string | null; can_open: boolean;
    }[]).map((a) => ({
      approvalItemId: a.approval_item_id,
      title: a.title,
      status: a.status,
      stepLabel: a.step_label,
      requestedByName: a.requested_by_name,
      requestedAt: a.requested_at,
      decidedAt: a.decided_at,
      canOpen: a.can_open,
    })),
  };
}
