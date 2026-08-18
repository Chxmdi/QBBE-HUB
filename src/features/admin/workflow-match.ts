export function workflowMatches(
  rule: { trigger_event: string; enabled: boolean; condition: { status?: string } },
  event: { type: string; status?: string },
): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger_event !== event.type) return false;
  if (rule.condition?.status && rule.condition.status !== event.status) return false;
  return true;
}

export interface WorkflowRuleRow {
  id: string;
  enabled: boolean;
  trigger_event: string;
  condition: { status?: string };
  action: { type?: string; teamId?: string };
}

export function matchingWorkflows(
  rules: WorkflowRuleRow[],
  event: { type: string; status?: string },
): WorkflowRuleRow[] {
  return rules.filter((rule) => workflowMatches(rule, event));
}

export function workflowRecipients(options: {
  actionType: string;
  assigneeId: string | null;
  eventOwnerId?: string | null;
  teamMemberIds?: string[];
  adminIds: string[];
  actorId: string;
}): string[] {
  const ids = options.actionType === "notify_admins"
    ? options.adminIds
    : options.actionType === "notify_event_owner"
      ? options.eventOwnerId ? [options.eventOwnerId] : []
      : options.actionType === "notify_team"
        ? options.teamMemberIds ?? []
      : options.assigneeId ? [options.assigneeId] : [];
  return [...new Set(ids.filter((id) => id && id !== options.actorId))];
}
