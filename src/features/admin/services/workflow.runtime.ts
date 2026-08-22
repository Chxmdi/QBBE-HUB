import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchingWorkflows,
  workflowRecipients,
  type WorkflowRuleRow,
} from "@/features/admin/workflow-match";

/**
 * Runs the workflow rules that match an event, and records what each one did.
 *
 * Every matched rule writes a `workflow_execution` row whether or not it
 * reached anybody. A rule that matched and then found no recipients is the most
 * useful thing to be able to see — without it, "why didn't this notify anyone?"
 * has no answer — so `skipped` is a recorded outcome, not a missing row.
 *
 * Logging never blocks the automation: a failure to write history is reported
 * and swallowed, because losing the notification would be worse than losing its
 * audit entry.
 */

export async function fireWorkflows(
  supabase: SupabaseClient,
  options: {
    organizationId: string;
    actorId: string;
    eventType:
      | "task_status_changed"
      | "announcement_published"
      | "project_health_changed"
      | "meeting_completed"
      | "event_assignment_created";
    status?: string;
    title: string;
    sourceType: string;
    sourceId: string;
    link: string;
    assigneeId?: string | null;
    eventOwnerId?: string | null;
  },
) {
  const { data: rules } = await supabase
    .from("workflow_rule")
    .select("id, name, enabled, trigger_event, condition, action")
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
  const targetTeamIds = [...new Set(
    matched
      .filter((rule) => rule.action?.type === "notify_team" && rule.action.teamId)
      .map((rule) => rule.action.teamId!),
  )];
  const { data: teamMembers } = targetTeamIds.length > 0
    ? await supabase
      .from("team_member")
      .select("team_id, user_id")
      .in("team_id", targetTeamIds)
    : { data: [] as { team_id: string; user_id: string }[] };
  const memberIdsByTeam = new Map<string, string[]>();
  for (const member of teamMembers ?? []) {
    const teamId = member.team_id as string;
    const memberIds = memberIdsByTeam.get(teamId) ?? [];
    memberIds.push(member.user_id as string);
    memberIdsByTeam.set(teamId, memberIds);
  }

  const executions: Record<string, unknown>[] = [];

  for (const rule of matched) {
    const recipients = workflowRecipients({
      actionType: rule.action?.type ?? "notify_assignee",
      assigneeId: options.assigneeId ?? null,
      eventOwnerId: options.eventOwnerId ?? null,
      teamMemberIds: rule.action?.teamId ? memberIdsByTeam.get(rule.action.teamId) ?? [] : [],
      adminIds,
      actorId: options.actorId,
    });

    const entry = {
      organization_id: options.organizationId,
      rule_id: rule.id,
      rule_name: (rule as { name?: string }).name ?? "Unnamed rule",
      trigger_event: options.eventType,
      source_type: options.sourceType,
      source_id: options.sourceId,
      recipient_count: recipients.length,
    };

    if (recipients.length === 0) {
      // Matched, but the action had nobody to address — worth recording,
      // because this is the shape of a misconfigured rule.
      executions.push({
        ...entry,
        outcome: "skipped",
        detail: `No recipient for action "${rule.action?.type ?? "notify_assignee"}".`,
      });
      continue;
    }

    const { error } = await supabase.from("notification").insert(
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

    executions.push(
      error
        ? { ...entry, outcome: "failed", detail: error.message.slice(0, 500) }
        : { ...entry, outcome: "notified" },
    );
  }

  if (executions.length > 0) {
    const { error } = await supabase.from("workflow_execution").insert(executions);
    // History is valuable, but not at the cost of the thing it describes.
    if (error) {
      console.error(
        JSON.stringify({ event: "workflow.history_write_failed", error: error.message }),
      );
    }
  }
}
