import type { SupabaseClient } from "@supabase/supabase-js";
import { isEnabled } from "@/lib/feature-flags";
import type { ObjectEvent } from "@/lib/objects/contracts";
import type { JobContext, JobResult } from "@/features/jobs/services/runner";
import { validateGraph } from "../graph";
import {
  activityRowToEvent,
  isAutomationEvent,
  matchesTrigger,
  type ActivityEventRow,
} from "../trigger";
import {
  executeWorkflowRun,
  GRAPH_RULE_COLUMNS,
  overRateLimit,
  recordRateLimited,
  type GraphRule,
} from "./run";

/**
 * The `workflow-events` job (M14b): reads events written since its cursor and
 * runs every enabled graph workflow whose trigger matches.
 *
 * Delivery is at least once: the cursor moves after the batch, so a crash
 * re-reads events. The unique (rule_id, trigger_event_id) index turns a re-read
 * into a skipped duplicate rather than a second run.
 *
 * The first run only sets the cursor to "now": switching the module on never
 * replays history into workflows.
 */

export const WORKFLOW_EVENTS_CONSUMER = "workflow-events";

const ACTIVITY_COLUMNS =
  "id, organization_id, actor_id, verb, source_type, source_id, project_id, program_id, summary, metadata, created_at";

interface Cursor {
  last_created_at: string | null;
  last_id: string | null;
}

async function readCursor(db: SupabaseClient): Promise<Cursor | null> {
  const { data, error } = await db
    .from("workflow_event_cursor")
    .select("last_created_at, last_id")
    .eq("consumer", WORKFLOW_EVENTS_CONSUMER)
    .maybeSingle();
  if (error) throw new Error(`could not read the workflow cursor: ${error.message}`);
  return (data as Cursor | null) ?? null;
}

async function writeCursor(db: SupabaseClient, cursor: Cursor, now: Date) {
  const { error } = await db.from("workflow_event_cursor").upsert({
    consumer: WORKFLOW_EVENTS_CONSUMER,
    last_created_at: cursor.last_created_at,
    last_id: cursor.last_id,
    updated_at: now.toISOString(),
  });
  if (error) throw new Error(`could not move the workflow cursor: ${error.message}`);
}

async function readEvents(db: SupabaseClient, cursor: Cursor, limit: number): Promise<ActivityEventRow[]> {
  let query = db.from("activity_event").select(ACTIVITY_COLUMNS);
  if (cursor.last_created_at) {
    const at = cursor.last_created_at;
    query = cursor.last_id
      ? query.or(`created_at.gt."${at}",and(created_at.eq."${at}",id.gt.${cursor.last_id})`)
      : query.gt("created_at", at);
  }
  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`could not read events: ${error.message}`);
  return (data ?? []) as ActivityEventRow[];
}

export type LimitedRule = GraphRule & { max_runs_per_hour: number };

/** Enabled graph workflows that are not stopped (the instant stop switch). */
export async function loadGraphRules(db: SupabaseClient, organizationIds: string[]): Promise<LimitedRule[]> {
  if (organizationIds.length === 0) return [];
  const { data, error } = await db
    .from("workflow_rule")
    .select(`${GRAPH_RULE_COLUMNS}, max_runs_per_hour`)
    .eq("engine", "graph_v2")
    .eq("enabled", true)
    .is("stopped_at", null)
    .in("organization_id", organizationIds);
  if (error) throw new Error(`could not load workflows: ${error.message}`);
  const rules: LimitedRule[] = [];
  for (const row of (data ?? []) as (Omit<LimitedRule, "graph"> & { graph: unknown })[]) {
    const checked = validateGraph(row.graph);
    // A graph that no longer validates is not run; the screen shows why.
    if (checked.ok) rules.push({ ...row, graph: checked.graph });
  }
  return rules;
}

export function rulesForEvent<R extends GraphRule>(rules: R[], event: ObjectEvent): R[] {
  if (isAutomationEvent(event)) return [];
  return rules.filter(
    (rule) => rule.organization_id === event.organizationId && matchesTrigger(rule.graph.trigger, event),
  );
}

export async function workflowEvents({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!(await isEnabled("wos_workflows_v2", db))) {
    return { processed: 0, failed: 0, metadata: { skipped: "wos_workflows_v2 is off" } };
  }

  const cursor = await readCursor(db);
  if (!cursor) {
    await writeCursor(db, { last_created_at: now.toISOString(), last_id: null }, now);
    return { processed: 0, failed: 0, metadata: { started: true } };
  }

  const rows = await readEvents(db, cursor, definition.batch_size);
  if (rows.length === 0) return { processed: 0, failed: 0 };

  const events = rows.map(activityRowToEvent).filter((event): event is ObjectEvent => event !== null);
  const rules = await loadGraphRules(db, [...new Set(events.map((event) => event.organizationId))]);

  let processed = 0;
  let failed = 0;
  let duplicates = 0;
  let rateLimited = 0;
  for (const event of events) {
    for (const rule of rulesForEvent(rules, event)) {
      try {
        if (await overRateLimit(db, rule.id, rule.max_runs_per_hour, now)) {
          rateLimited += 1;
          await recordRateLimited(db, rule, event, now);
          continue;
        }
        const record = await executeWorkflowRun(db, { rule, event });
        if (record.status === "duplicate") duplicates += 1;
        else if (record.result.outcome === "failed") failed += 1;
        else processed += 1;
      } catch (error) {
        failed += 1;
        console.error(JSON.stringify({
          event: "workflow.run_failed",
          workflow: rule.id,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }

  const last = rows[rows.length - 1];
  await writeCursor(db, { last_created_at: last.created_at, last_id: last.id }, now);
  // A failed run is recorded on the run; it is not a failure of this job.
  return { processed, failed: 0, metadata: { events: rows.length, runsFailed: failed, duplicates, rateLimited } };
}
