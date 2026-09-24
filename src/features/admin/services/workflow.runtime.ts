import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchingWorkflows,
  workflowRecipients,
  type WorkflowRuleRow,
} from "@/features/admin/workflow-match";

export interface WorkflowEventRow {
  id: string;
  organization_id: string;
  event_key: string;
  event_type: string;
  source_type: string;
  source_id: string;
  actor_id: string;
  payload: {
    status?: string;
    title: string;
    link: string;
    assigneeId?: string | null;
    eventOwnerId?: string | null;
  };
  status: "pending" | "processing" | "completed" | "failed";
  attempt: number;
}

interface FireWorkflowOptions {
  organizationId: string;
  actorId: string;
  eventKey: string;
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
}

async function loadWorkflowEvent(
  supabase: SupabaseClient,
  organizationId: string,
  eventKey: string,
): Promise<WorkflowEventRow | null> {
  const { data, error } = await supabase
    .from("workflow_event")
    .select("id, organization_id, event_key, event_type, source_type, source_id, actor_id, payload, status, attempt")
    .eq("organization_id", organizationId)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (error) throw new Error(`Could not load workflow event: ${error.message}`);
  return (data as unknown as WorkflowEventRow | null) ?? null;
}

async function persistWorkflowEvent(
  supabase: SupabaseClient,
  options: FireWorkflowOptions,
): Promise<WorkflowEventRow> {
  const existing = await loadWorkflowEvent(
    supabase,
    options.organizationId,
    options.eventKey,
  );
  if (existing) return existing;

  const row = {
    organization_id: options.organizationId,
    event_key: options.eventKey,
    event_type: options.eventType,
    source_type: options.sourceType,
    source_id: options.sourceId,
    actor_id: options.actorId,
    payload: {
      status: options.status,
      title: options.title,
      link: options.link,
      assigneeId: options.assigneeId ?? null,
      eventOwnerId: options.eventOwnerId ?? null,
    },
  };

  const { data, error } = await supabase
    .from("workflow_event")
    .insert(row)
    .select("id, organization_id, event_key, event_type, source_type, source_id, actor_id, payload, status, attempt")
    .maybeSingle();

  if (!error && data) return data as unknown as WorkflowEventRow;

  // Two identical requests can race on the unique event key. The winner wrote
  // the durable event; the loser should join it rather than report a failure.
  if (error?.code === "23505") {
    const raced = await loadWorkflowEvent(
      supabase,
      options.organizationId,
      options.eventKey,
    );
    if (raced) return raced;
  }

  throw new Error(`Could not persist workflow event: ${error?.message ?? "no row"}`);
}

async function upsertExecution(
  supabase: SupabaseClient,
  event: WorkflowEventRow,
  rule: WorkflowRuleRow,
  input: {
    outcome: "notified" | "skipped" | "failed";
    recipientCount: number;
    detail?: string | null;
  },
) {
  const { error } = await supabase.from("workflow_execution").upsert({
    organization_id: event.organization_id,
    workflow_event_id: event.id,
    event_key: event.event_key,
    rule_id: rule.id,
    rule_name: (rule as WorkflowRuleRow & { name?: string }).name ?? "Unnamed rule",
    trigger_event: event.event_type,
    source_type: event.source_type,
    source_id: event.source_id,
    outcome: input.outcome,
    recipient_count: input.recipientCount,
    detail: input.detail ?? null,
  }, { onConflict: "rule_id,event_key" });

  if (error) throw new Error(`Could not save workflow execution: ${error.message}`);
}

async function markWorkflowEvent(
  supabase: SupabaseClient,
  eventId: string,
  update: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("workflow_event")
    .update(update)
    .eq("id", eventId);
  if (error) throw new Error(`Could not update workflow event: ${error.message}`);
}

/**
 * Processes one durable workflow event.
 *
 * A notification's dedupe key includes the stable event key, so the same event
 * can be retried without duplicate side effects while a later distinct event
 * on the same source remains deliverable.
 */
export async function processWorkflowEvent(
  supabase: SupabaseClient,
  event: WorkflowEventRow,
): Promise<{ completed: boolean; failedRules: number }> {
  if (event.status === "completed") return { completed: true, failedRules: 0 };

  const attempt = event.attempt + 1;
  await markWorkflowEvent(supabase, event.id, {
    status: "processing",
    attempt,
    last_error: null,
  });

  try {
    const [{ data: rules, error: rulesError }, { data: activeMemberships, error: memberError }] =
      await Promise.all([
        supabase
          .from("workflow_rule")
          .select("id, name, enabled, trigger_event, condition, action")
          .eq("organization_id", event.organization_id)
          .eq("enabled", true),
        supabase
          .from("organization_membership")
          .select("user_id, role")
          .eq("organization_id", event.organization_id)
          .eq("status", "active"),
      ]);
    if (rulesError) throw new Error(`Could not load workflow rules: ${rulesError.message}`);
    if (memberError) throw new Error(`Could not load active workflow recipients: ${memberError.message}`);

    const matched = matchingWorkflows(
      (rules ?? []) as unknown as WorkflowRuleRow[],
      { type: event.event_type, status: event.payload.status },
    );
    if (matched.length === 0) {
      await markWorkflowEvent(supabase, event.id, {
        status: "completed",
        processed_at: new Date().toISOString(),
        last_error: null,
      });
      return { completed: true, failedRules: 0 };
    }

    const activeIds = new Set(
      (activeMemberships ?? []).map((row) => row.user_id as string),
    );
    const adminIds = (activeMemberships ?? [])
      .filter((row) => row.role === "owner" || row.role === "admin")
      .map((row) => row.user_id as string);

    const targetTeamIds = [...new Set(
      matched
        .filter((rule) => rule.action?.type === "notify_team" && rule.action.teamId)
        .map((rule) => rule.action.teamId!),
    )];
    const { data: teamMembers, error: teamError } = targetTeamIds.length
      ? await supabase
          .from("team_member")
          .select("team_id, user_id")
          .in("team_id", targetTeamIds)
      : { data: [] as { team_id: string; user_id: string }[], error: null };
    if (teamError) throw new Error(`Could not load workflow team members: ${teamError.message}`);

    const memberIdsByTeam = new Map<string, string[]>();
    for (const member of teamMembers ?? []) {
      const userId = member.user_id as string;
      if (!activeIds.has(userId)) continue;
      const teamId = member.team_id as string;
      const ids = memberIdsByTeam.get(teamId) ?? [];
      ids.push(userId);
      memberIdsByTeam.set(teamId, ids);
    }

    let failedRules = 0;

    for (const rule of matched) {
      const { data: prior, error: priorError } = await supabase
        .from("workflow_execution")
        .select("outcome")
        .eq("rule_id", rule.id)
        .eq("event_key", event.event_key)
        .maybeSingle();
      if (priorError) throw new Error(`Could not load workflow execution: ${priorError.message}`);
      if (prior?.outcome === "notified" || prior?.outcome === "skipped") continue;

      const recipients = workflowRecipients({
        actionType: rule.action?.type ?? "notify_assignee",
        assigneeId: event.payload.assigneeId ?? null,
        eventOwnerId: event.payload.eventOwnerId ?? null,
        teamMemberIds: rule.action?.teamId
          ? memberIdsByTeam.get(rule.action.teamId) ?? []
          : [],
        adminIds,
        actorId: event.actor_id,
      }).filter((userId) => activeIds.has(userId));

      if (recipients.length === 0) {
        await upsertExecution(supabase, event, rule, {
          outcome: "skipped",
          recipientCount: 0,
          detail: `No active recipient for action "${rule.action?.type ?? "notify_assignee"}".`,
        });
        continue;
      }

      let ruleFailed = false;
      let detail: string | null = null;
      for (const userId of recipients) {
        const { error } = await supabase.from("notification").insert({
          user_id: userId,
          organization_id: event.organization_id,
          category: "assignment",
          title: `Workflow: ${event.payload.title}`,
          source_type: event.source_type,
          source_id: event.source_id,
          link: event.payload.link,
          urgency: "normal",
          dedupe_key: `workflow:${rule.id}:${event.event_key}:${userId}`,
        });
        // 23505 means a prior attempt already completed this exact side effect.
        if (error && error.code !== "23505") {
          ruleFailed = true;
          detail = error.message.slice(0, 500);
          break;
        }
      }

      await upsertExecution(supabase, event, rule, {
        outcome: ruleFailed ? "failed" : "notified",
        recipientCount: recipients.length,
        detail,
      });
      if (ruleFailed) failedRules += 1;
    }

    await markWorkflowEvent(supabase, event.id, {
      status: failedRules ? "failed" : "completed",
      processed_at: failedRules ? null : new Date().toISOString(),
      last_error: failedRules ? `${failedRules} workflow rule(s) failed.` : null,
    });
    return { completed: failedRules === 0, failedRules };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    await markWorkflowEvent(supabase, event.id, {
      status: "failed",
      last_error: detail.slice(0, 1000),
    }).catch(() => undefined);
    throw cause;
  }
}

/**
 * Persists a workflow event before attempting side effects. Failure to run the
 * automation never rolls back the already-completed business action; the retry
 * worker resumes the durable event instead.
 */
export async function fireWorkflows(
  supabase: SupabaseClient,
  options: FireWorkflowOptions,
): Promise<void> {
  try {
    const event = await persistWorkflowEvent(supabase, options);
    if (event.status !== "completed") await processWorkflowEvent(supabase, event);
  } catch (cause) {
    console.error(JSON.stringify({
      event: "workflow.event_failed",
      eventKey: options.eventKey,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      error: cause instanceof Error ? cause.message : String(cause),
    }));
  }
}
