import type { SupabaseClient } from "@supabase/supabase-js";
import { isEnabled } from "@/lib/feature-flags";
import type { QuerySpec } from "@/lib/objects/contracts";
import { calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";
import { createNotifications, type NotificationDraft } from "@/features/jobs/services/notify";
import type { JobContext, JobResult } from "@/features/jobs/services/runner";
import {
  TASK_ROW_COLUMNS,
  categoryFor,
  classifyEvent,
  effectiveRule,
  linkFor,
  taskMatchesQuery,
  type ActivityEvent,
  type FollowRule,
  type TaskRow,
} from "./rules";

/**
 * Tells followers about changes (V1-14).
 *
 * Reads activity_event after its cursor, finds who follows each changed
 * object (directly, through its project, or through a followed query), checks
 * each of them can still see it (public.can_as, answered as that person), and
 * applies their rule for that kind of change. What survives becomes an
 * ordinary notification with category follow_<kind>, so the existing email
 * pipeline, quiet hours, digests and recipient allow-list all apply.
 *
 * The cursor advances only after the batch is written; a crash re-reads the
 * batch, and the dedupe key (follow:<event>) stops a second notification.
 */

export const FOLLOW_CONSUMER = "follow-events";
import { FOLLOWING_FLAG as FLAG } from "./gate";

interface FollowRow {
  user_id: string;
  object_id: string | null;
  query_spec: QuerySpec | null;
}

interface Recipient {
  userId: string;
  event: ActivityEvent;
}

/** Who should hear about each event, before access checks and rules. Pure. */
export function candidatesFor(
  events: ActivityEvent[],
  follows: FollowRow[],
  tasks: Map<string, TaskRow>,
  today: string,
): Recipient[] {
  const out: Recipient[] = [];
  for (const event of events) {
    const seen = new Set<string>();
    const add = (userId: string) => {
      // People are not told about their own changes.
      if (userId === event.actor_id || seen.has(userId)) return;
      seen.add(userId);
      out.push({ userId, event });
    };
    for (const follow of follows) {
      if (follow.object_id && (follow.object_id === event.source_id || follow.object_id === event.project_id)) {
        add(follow.user_id);
      }
    }
    const task = event.source_type === "task" ? tasks.get(event.source_id) : undefined;
    if (task) {
      for (const follow of follows) {
        if (follow.query_spec && taskMatchesQuery(follow.query_spec, task, { userId: follow.user_id, today })) {
          add(follow.user_id);
        }
      }
    }
  }
  return out;
}

export async function followFanout({ db, definition, now }: JobContext): Promise<JobResult> {
  if (!(await isEnabled(FLAG, db))) {
    return { processed: 0, failed: 0, metadata: { skipped: "switch off" } };
  }
  const { data: cursor } = await db
    .from("follow_event_cursor")
    .select("last_created_at, last_id")
    .eq("consumer", FOLLOW_CONSUMER)
    .maybeSingle();
  const after = (cursor?.last_created_at as string | undefined) ?? "1970-01-01T00:00:00Z";
  const afterId = (cursor?.last_id as string | null | undefined) ?? null;

  // A bulk edit writes many events with one timestamp, so the position is the
  // pair (time, id): later times, or the same time with a later id.
  let query = db
    .from("activity_event")
    .select("id, organization_id, actor_id, verb, source_type, source_id, project_id, program_id, summary, metadata, created_at");
  query = afterId
    ? query.or(`created_at.gt.${after},and(created_at.eq.${after},id.gt.${afterId})`)
    : query.gt("created_at", after);
  const { data: eventRows, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(definition.batch_size);
  if (error) throw new Error(`could not read events: ${error.message}`);
  const events = (eventRows ?? []) as ActivityEvent[];
  if (events.length === 0) return { processed: 0, failed: 0 };

  const drafts = await draftsFor(db, events, now);
  const inserted = drafts.length ? await createNotifications(db, drafts) : 0;

  const last = events[events.length - 1];
  const { error: cursorError } = await db
    .from("follow_event_cursor")
    .upsert({ consumer: FOLLOW_CONSUMER, last_created_at: last.created_at, last_id: last.id, updated_at: now.toISOString() });
  if (cursorError) throw new Error(`could not advance the follow cursor: ${cursorError.message}`);

  return { processed: inserted, failed: 0, metadata: { events: events.length } };
}

async function draftsFor(db: SupabaseClient, events: ActivityEvent[], now: Date): Promise<NotificationDraft[]> {
  const organizations = [...new Set(events.map((e) => e.organization_id))];
  const objectIds = [...new Set(events.flatMap((e) => [e.source_id, e.project_id].filter((id): id is string => Boolean(id))))];
  const taskIds = [...new Set(events.filter((e) => e.source_type === "task").map((e) => e.source_id))];

  const [{ data: objectFollows }, { data: queryFollows }, { data: taskRows }] = await Promise.all([
    db.from("follow_v2").select("user_id, object_id, query_spec").in("object_id", objectIds),
    db.from("follow_v2").select("user_id, object_id, query_spec").in("organization_id", organizations).not("query_spec", "is", null),
    taskIds.length ? db.from("task").select(TASK_ROW_COLUMNS).in("id", taskIds) : Promise.resolve({ data: [] }),
  ]);
  const follows = [...((objectFollows ?? []) as FollowRow[]), ...((queryFollows ?? []) as FollowRow[])];
  if (follows.length === 0) return [];
  const tasks = new Map(((taskRows ?? []) as TaskRow[]).map((t) => [t.id, t]));
  const today = calendarDateInZone(now, DEFAULT_TIME_ZONE) ?? now.toISOString().slice(0, 10);
  const candidates = candidatesFor(events, follows, tasks, today);
  if (candidates.length === 0) return [];

  const users = [...new Set(candidates.map((c) => c.userId))];
  const { data: ruleRows } = await db
    .from("follow_rule_v2")
    .select("user_id, event_kind, in_app, email")
    .in("user_id", users);
  const rulesByUser = new Map<string, FollowRule[]>();
  for (const row of (ruleRows ?? []) as (FollowRule & { user_id: string })[]) {
    rulesByUser.set(row.user_id, [...(rulesByUser.get(row.user_id) ?? []), row]);
  }

  const drafts: NotificationDraft[] = [];
  for (const { userId, event } of candidates) {
    const kind = classifyEvent(event);
    if (!effectiveRule(rulesByUser.get(userId) ?? [], kind).in_app) continue;
    // Asked as the follower, never as the job: access may have changed since they followed.
    const { data: allowed } = await db.rpc("can_as", {
      p_user: userId,
      p_object: event.source_id,
      p_capability: "view",
      p_assurance: "aal1",
    });
    if (allowed !== true) continue;
    drafts.push({
      user_id: userId,
      organization_id: event.organization_id,
      category: categoryFor(kind),
      title: event.summary.slice(0, 300),
      source_type: event.source_type,
      source_id: event.source_id,
      link: linkFor(event),
      project_id: event.project_id,
      dedupe_key: `follow:${event.id}`,
    });
  }
  return drafts;
}
