import type { SupabaseClient } from "@supabase/supabase-js";
import type { HomeData } from "../model";
import { FIRST_VISIT_DAYS, type DigestActivity, type DigestInput } from "../digest";

type Db = Pick<SupabaseClient, "from" | "rpc">;

function rows<T>(result: { data: unknown }): T[] {
  return (result.data ?? []) as T[];
}

/**
 * Records this Home visit and returns where the digest starts: the end of the
 * previous visit, or FIRST_VISIT_DAYS ago for a first visit (or if the visit
 * cannot be recorded, which only loses the exact starting point).
 */
export async function awaySince(db: Db, organizationId: string, now: Date = new Date()): Promise<{ since: string; firstVisit: boolean }> {
  const fallback = new Date(now.getTime() - FIRST_VISIT_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.rpc("home_away_since", { p_organization: organizationId });
  if (error || !data) return { since: fallback, firstVisit: !error };
  return { since: new Date(data as string).toISOString(), firstVisit: false };
}

/**
 * The changes since `since` on what the viewer follows, read through their own
 * client. The followed tasks and projects come from Home's own load, plus any
 * task the viewer holds a task role on (follower, contributor and so on).
 */
export async function loadDigestInput(
  db: Db,
  home: HomeData,
  since: string,
): Promise<DigestInput> {
  const userId = home.userId;
  const { data: roles } = await db.from("task_assignment").select("task_id, task:task_id(title)").eq("user_id", userId).limit(200);
  const taskTitles = new Map(home.tasks.map((task) => [task.id, task.title]));
  for (const role of rows<{ task_id: string; task: { title: string } | null }>({ data: roles })) {
    if (role.task) taskTitles.set(role.task_id, role.task.title);
  }
  const followedTaskIds = new Set(taskTitles.keys());
  const followedProjectIds = new Set(home.projects.map((project) => project.id));

  const activityFilters = [
    ...(followedTaskIds.size ? [`and(source_type.eq.task,source_id.in.(${[...followedTaskIds].join(",")}))`] : []),
    ...(followedProjectIds.size ? [`project_id.in.(${[...followedProjectIds].join(",")})`] : []),
  ];

  const programIds = [
    ...new Set(
      home.projects
        .map((project) => project.program_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [activity, forMe, mine, updates, metrics] = await Promise.all([
    activityFilters.length
      ? db
          .from("activity_event")
          .select("id, actor_id, verb, source_type, source_id, project_id, summary, created_at, metadata, actor:actor_id(full_name)")
          .gt("created_at", since)
          .neq("actor_id", userId)
          .or(activityFilters.join(","))
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
    db
      .from("approval_request")
      .select("id, note, created_at, requester:requested_by(full_name)")
      .eq("approver_id", userId)
      .eq("decision", "pending")
      .gt("created_at", since)
      .limit(20),
    db
      .from("approval_request")
      .select("id, note, decision, decided_at")
      .eq("requested_by", userId)
      .gt("decided_at", since)
      .limit(20),
    followedProjectIds.size
      ? db
          .from("project_status_update")
          .select("id, project_id, health, created_at, project:project_id(name)")
          .in("project_id", [...followedProjectIds])
          .order("created_at", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
    db
      .from("outcome_metric")
      .select("id, name, unit, program_id")
      .is("retired_at", null)
      .or([`owner_id.eq.${userId}`, ...(programIds.length ? [`program_id.in.(${programIds.join(",")})`] : [])].join(","))
      .limit(50),
  ]);

  // Health changes: each update since `since` against the update before it.
  type Update = { id: string; project_id: string; health: string; created_at: string; project: { name: string } | null };
  const updateRows = rows<Update>(updates);
  const statusUpdates = updateRows
    .filter((update) => update.created_at > since)
    .map((update) => {
      const previous = updateRows.find(
        (other) => other.project_id === update.project_id && other.created_at < update.created_at,
      );
      return {
        id: update.id,
        project_id: update.project_id,
        project_name: update.project?.name ?? "",
        health: update.health,
        previous: previous?.health ?? null,
        created_at: update.created_at,
      };
    });

  // Number changes: each measurement since `since` against the one before it.
  type Metric = { id: string; name: string; unit: string | null; program_id: string | null };
  const metricRows = rows<Metric>(metrics);
  const measurementRows = metricRows.length
    ? rows<{ id: string; metric_id: string; value: number; measured_on: string; created_at: string }>(
        await db
          .from("outcome_measurement")
          .select("id, metric_id, value, measured_on, created_at")
          .in("metric_id", metricRows.map((metric) => metric.id))
          .order("measured_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
      )
    : [];
  const measurements = measurementRows
    .filter((measurement) => measurement.created_at > since)
    .map((measurement) => {
      const metric = metricRows.find((candidate) => candidate.id === measurement.metric_id)!;
      const previous = measurementRows.find(
        (other) =>
          other.metric_id === measurement.metric_id &&
          other.id !== measurement.id &&
          (other.measured_on < measurement.measured_on ||
            (other.measured_on === measurement.measured_on && other.created_at < measurement.created_at)),
      );
      return {
        id: measurement.id,
        metric_id: measurement.metric_id,
        metric_name: metric.name,
        unit: metric.unit,
        value: Number(measurement.value),
        previous: previous ? Number(previous.value) : null,
        created_at: measurement.created_at,
        href: metric.program_id ? `/programs/${metric.program_id}` : "/",
      };
    });

  return {
    userId,
    since,
    followedTaskIds,
    followedProjectIds,
    taskTitles,
    activity: rows<DigestActivity>(activity),
    approvalsForMe: rows<{ id: string; note: string | null; created_at: string; requester: { full_name: string } | null }>(forMe).map(
      (approval) => ({ id: approval.id, note: approval.note, created_at: approval.created_at, requested_by_name: approval.requester?.full_name ?? null }),
    ),
    myDecidedRequests: rows<{ id: string; note: string | null; decision: string; decided_at: string }>(mine),
    measurements,
    statusUpdates,
  };
}
