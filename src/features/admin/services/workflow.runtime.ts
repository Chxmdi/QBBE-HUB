import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchingWorkflows,
  workflowRecipients,
  type WorkflowRuleRow,
} from "@/features/admin/workflow-match";

export async function fireWorkflows(
  supabase: SupabaseClient,
  options: {
    organizationId: string;
    actorId: string;
    eventType: "task_status_changed" | "announcement_published";
    status?: string;
    title: string;
    sourceType: string;
    sourceId: string;
    link: string;
    assigneeId?: string | null;
  },
) {
  const { data: rules } = await supabase
    .from("workflow_rule")
    .select("id, enabled, trigger_event, condition, action")
    .eq("organization_id", options.organizationId)
    .eq("enabled", true);

  const matched = matchingWorkflows(
    (rules ?? []) as unknown as WorkflowRuleRow[],
    { type: options.eventType, status: options.status },
  );
  if (matched.length === 0) return;

  const { data: admins } = await supabase
    .from("organization_membership")
    .select("user_id")
    .eq("organization_id", options.organizationId)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  const adminIds = (admins ?? []).map((row) => row.user_id as string);

  for (const rule of matched) {
    const recipients = workflowRecipients({
      actionType: rule.action?.type ?? "notify_assignee",
      assigneeId: options.assigneeId ?? null,
      adminIds,
      actorId: options.actorId,
    });
    if (recipients.length === 0) continue;
    await supabase.from("notification").insert(
      recipients.map((userId) => ({
        user_id: userId,
        organization_id: options.organizationId,
        category: "assignment",
        title: `Workflow: ${options.title}`,
        source_type: options.sourceType,
        source_id: options.sourceId,
        link: options.link,
        urgency: "normal",
        dedupe_key: `workflow:${rule.id}:${options.sourceId}:${userId}`,
      })),
    );
  }
}
