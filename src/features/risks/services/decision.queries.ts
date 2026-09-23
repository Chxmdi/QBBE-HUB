import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DecisionRequestStatus } from "@/features/risks/schemas";

export interface DecisionRow {
  id: string;
  title: string;
  detail: string | null;
  alternatives: string | null;
  affected_records: string[];
  reopen_conditions: string | null;
  decided_at: string;
  reopened_at: string | null;
  owner: { id: string; full_name: string } | null;
}

export interface DecisionRequestRow {
  id: string;
  context: string;
  due_at: string;
  status: DecisionRequestStatus;
  decision_id: string | null;
  assignee: { id: string; full_name: string } | null;
  requester: { id: string; full_name: string } | null;
}

export async function getProjectDecisions(projectId: string): Promise<{
  decisions: DecisionRow[];
  requests: DecisionRequestRow[];
}> {
  const supabase = await createSupabaseServerClient();
  const [decisions, requests] = await Promise.all([
    supabase
      .from("decision")
      .select(
        "id, title, detail, alternatives, affected_records, reopen_conditions, decided_at, reopened_at, owner:decided_by(id, full_name)",
      )
      .eq("project_id", projectId)
      .order("decided_at", { ascending: false }),
    supabase
      .from("decision_request")
      .select(
        "id, context, due_at, status, decision_id, assignee:assignee_id(id, full_name), requester:requester_id(id, full_name)",
      )
      .eq("project_id", projectId)
      .order("due_at", { ascending: true }),
  ]);

  return {
    decisions: (decisions.data ?? []) as unknown as DecisionRow[],
    requests: (requests.data ?? []) as unknown as DecisionRequestRow[],
  };
}
