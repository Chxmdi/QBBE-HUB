export function workflowMatches(
  rule: { trigger_event: string; enabled: boolean; condition: { status?: string } },
  event: { type: string; status?: string },
): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger_event !== event.type) return false;
  if (rule.condition?.status && rule.condition.status !== event.status) return false;
  return true;
}
