import type { SupabaseClient } from "@supabase/supabase-js";
import { addCalendarDays, calendarDateInZone, startOfDayInstant } from "@/lib/time";
import {
  OPEN_STATUSES,
  type HomeActivity,
  type HomeApproval,
  type HomeData,
  type HomeDecision,
  type HomeMeeting,
  type HomeMention,
  type HomeProject,
  type HomeTask,
} from "../model";
import { CHANGES_DAYS, CONTINUE_DAYS } from "../sections";

const TASK_COLUMNS =
  "id, title, status, priority, due_at, assignee_id, requester_id, reviewer_id, approver_id, project_id, " +
  "blocked_reason, updated_at, project:project_id(id, name), assignee:assignee_id(full_name)";
const MEETING_COLUMNS = "id, title, starts_at, ends_at, status, organizer_id";
const PROJECT_COLUMNS = "id, name, stage, health, priority, target_date, owner_id, sponsor_id, updated_at";
const ACTIVITY_COLUMNS =
  "id, actor_id, verb, source_type, source_id, project_id, summary, created_at, actor:actor_id(full_name)";

const MEETING_DAYS = 14;
const MENTION_DAYS = 30;

type Db = Pick<SupabaseClient, "from">;

function rows<T>(result: { data: unknown }): T[] {
  return (result.data ?? []) as T[];
}

/**
 * Everything Home and My World show, read through the viewer's own client.
 * Nine small queries, run two rounds deep: the second round needs the ids of
 * the viewer's tasks and projects from the first.
 */
export async function loadHomeData(
  db: Db,
  viewer: { userId: string; timeZone: string },
  now: Date = new Date(),
): Promise<HomeData> {
  const { userId, timeZone } = viewer;
  const today = calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
  const from = startOfDayInstant(today, timeZone)?.toISOString() ?? now.toISOString();
  const until = startOfDayInstant(addCalendarDays(today, MEETING_DAYS) ?? today, timeZone)?.toISOString() ?? from;
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const [tasks, organized, attending, owned, approvals, decisions, mine, mentions] = await Promise.all([
    db
      .from("task")
      .select(TASK_COLUMNS)
      .is("archived_at", null)
      .in("status", [...OPEN_STATUSES])
      .or(
        [`assignee_id.eq.${userId}`, `requester_id.eq.${userId}`, `reviewer_id.eq.${userId}`, `approver_id.eq.${userId}`].join(","),
      )
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    db
      .from("meeting")
      .select(MEETING_COLUMNS)
      .eq("organizer_id", userId)
      .gte("starts_at", from)
      .lt("starts_at", until)
      .order("starts_at")
      .limit(50),
    db
      .from("meeting_attendee")
      .select(`meeting:meeting_id!inner(${MEETING_COLUMNS})`)
      .eq("user_id", userId)
      .gte("meeting.starts_at", from)
      .lt("meeting.starts_at", until)
      .limit(100),
    db
      .from("project")
      .select(PROJECT_COLUMNS)
      .is("archived_at", null)
      .is("completed_at", null)
      .or(`owner_id.eq.${userId},sponsor_id.eq.${userId}`)
      .limit(50),
    db
      .from("approval_request")
      .select("id, note, due_at, created_at, requested_by, project_request_id, report_id, opportunity_id")
      .eq("approver_id", userId)
      .eq("decision", "pending")
      .order("created_at")
      .limit(20),
    db
      .from("decision")
      .select("id, title, decided_at, project_id, meeting_id")
      .gte("decided_at", since(CONTINUE_DAYS))
      .order("decided_at", { ascending: false })
      .limit(20),
    db
      .from("activity_event")
      .select(ACTIVITY_COLUMNS)
      .eq("actor_id", userId)
      .gte("created_at", since(CONTINUE_DAYS))
      .order("created_at", { ascending: false })
      .limit(40),
    db
      .from("notification")
      .select("id, title, body, link, created_at, read_at, source_type, source_id, project_id")
      .eq("user_id", userId)
      .eq("category", "mention")
      .gte("created_at", since(MENTION_DAYS))
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const taskRows = rows<HomeTask>(tasks);
  const meetingMap = new Map<string, HomeMeeting>();
  for (const meeting of rows<HomeMeeting>(organized)) meetingMap.set(meeting.id, meeting);
  for (const row of rows<{ meeting: HomeMeeting | null }>(attending)) {
    const meeting = row.meeting;
    if (meeting) meetingMap.set(meeting.id, meeting);
  }

  // Projects of my tasks, as well as those I own or sponsor.
  const projectMap = new Map<string, HomeProject>(rows<HomeProject>(owned).map((project) => [project.id, project]));
  const taskProjectIds = [...new Set(taskRows.map((task) => task.project_id).filter((id): id is string => Boolean(id)))]
    .filter((id) => !projectMap.has(id));
  const myTaskIds = taskRows.filter((task) => task.assignee_id === userId).map((task) => task.id);

  const [taskProjects, others, dependencies] = await Promise.all([
    taskProjectIds.length
      ? db.from("project").select(PROJECT_COLUMNS).in("id", taskProjectIds).is("archived_at", null)
      : Promise.resolve({ data: [] }),
    (async () => {
      const projectIds = [...projectMap.keys(), ...taskProjectIds];
      const filters = [
        ...(projectIds.length ? [`project_id.in.(${projectIds.join(",")})`] : []),
        ...(myTaskIds.length ? [`and(source_type.eq.task,source_id.in.(${myTaskIds.join(",")}))`] : []),
      ];
      if (!filters.length) return { data: [] };
      return db
        .from("activity_event")
        .select(ACTIVITY_COLUMNS)
        .neq("actor_id", userId)
        .gte("created_at", since(CHANGES_DAYS))
        .or(filters.join(","))
        .order("created_at", { ascending: false })
        .limit(40);
    })(),
    // Open tasks my tasks block. The blocked task is read through RLS too, so
    // a dependency on a task the viewer cannot see is not counted.
    myTaskIds.length
      ? db
          .from("task_dependency")
          .select("blocking_task_id, blocked_task_id, blocked:blocked_task_id!inner(status, archived_at)")
          .in("blocking_task_id", myTaskIds)
          .in("blocked.status", [...OPEN_STATUSES])
          .is("blocked.archived_at", null)
      : Promise.resolve({ data: [] }),
  ]);
  for (const project of rows<HomeProject>(taskProjects)) projectMap.set(project.id, project);

  return {
    userId,
    now,
    timeZone,
    tasks: taskRows,
    meetings: [...meetingMap.values()],
    projects: [...projectMap.values()],
    approvals: rows<HomeApproval>(approvals),
    decisions: rows<HomeDecision>(decisions),
    activity: [...rows<HomeActivity>(mine), ...rows<HomeActivity>(others)],
    mentions: rows<HomeMention>(mentions),
    dependencies: rows<{ blocking_task_id: string; blocked_task_id: string }>(dependencies).map(
      ({ blocking_task_id, blocked_task_id }) => ({ blocking_task_id, blocked_task_id }),
    ),
  };
}
