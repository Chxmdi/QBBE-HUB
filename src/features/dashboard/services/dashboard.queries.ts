import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActivityEvent,
  Announcement,
  EventRecord,
  Meeting,
  Message,
  Project,
  Task,
} from "@/types/entities";
import { TASK_SELECT } from "@/features/tasks/services/task.queries";

export interface ProgramHealthRow {
  id: string;
  name: string;
  completionPercent: number;
  totalTasks: number;
  statusLabel: "On track" | "Needs attention" | "At risk" | "No projects";
  tone: "good" | "attention" | "risk" | "neutral";
}

export interface AnnouncementRail {
  channelId: string | null;
  latest:
    | (Announcement & {
        ackCount: number;
        totalRecipients: number;
        acknowledgedByMe: boolean;
        authorName: string;
      })
    | null;
  recentMessages: Message[];
}

export interface DashboardData {
  kpis: {
    activePrograms: number;
    activeProjects: number;
    openTasks: number;
    dueThisWeek: number;
    overdue: number;
    completedLast30: number;
  };
  healthCounts: Record<string, number>;
  attention: {
    overdueTasks: Task[];
    blockedTasks: Task[];
    unassignedTasks: Task[];
    riskyProjects: Project[];
  };
  requiredAnnouncements: Announcement[];
  recentActivity: ActivityEvent[];
  todayTasks: Task[];
  todayMeetings: Meeting[];
  upcomingEvents: EventRecord[];
  programHealth: ProgramHealthRow[];
  weeklyCompleted: { label: string; value: number }[];
  statusBreakdown: { completed: number; inProgress: number; toDo: number; overdue: number };
  completedPrevious30: number;
  announcementRail: AnnouncementRail;
}

const OPEN_STATUSES = [
  "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
];

/**
 * All dashboard metrics are computed from live, RLS-scoped data (WORK-001):
 * every count reflects only records the viewer may access.
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [
    programsRes,
    projectsRes,
    openTasksRes,
    dueWeekRes,
    overdueRes,
    completedRes,
    healthRes,
    overdueTasksRes,
    blockedTasksRes,
    unassignedTasksRes,
    riskyProjectsRes,
    announcementsRes,
    myAcksRes,
    activityRes,
  ] = await Promise.all([
    supabase
      .from("program")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("project")
      .select("id", { count: "exact", head: true })
      .eq("stage", "active")
      .is("archived_at", null),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_STATUSES)
      .is("archived_at", null),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_STATUSES)
      .is("archived_at", null)
      .gte("due_at", today)
      .lte("due_at", weekOut),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .in("status", OPEN_STATUSES)
      .is("archived_at", null)
      .lt("due_at", today),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", monthAgo),
    supabase
      .from("project")
      .select("health")
      .eq("stage", "active")
      .is("archived_at", null),
    supabase
      .from("task")
      .select(TASK_SELECT)
      .in("status", OPEN_STATUSES)
      .is("archived_at", null)
      .lt("due_at", today)
      .order("due_at")
      .limit(5),
    supabase
      .from("task")
      .select(TASK_SELECT)
      .eq("status", "blocked")
      .is("archived_at", null)
      .limit(5),
    supabase
      .from("task")
      .select(TASK_SELECT)
      .in("status", OPEN_STATUSES)
      .is("archived_at", null)
      .is("assignee_id", null)
      .limit(5),
    supabase
      .from("project")
      .select("id, name, health, health_reason, stage, target_date, owner:owner_id(id, full_name, email, avatar_url, title, timezone)")
      .in("health", ["at_risk", "off_track"])
      .is("archived_at", null)
      .limit(5),
    supabase
      .from("announcement")
      .select(
        "id, message_id, title, priority, requires_ack, ack_deadline, publish_at, expires_at, created_by, created_at, message:message_id(id, body, author_id, channel_id, conversation_id, thread_root_id, is_system, created_at, edited_at, deleted_at)",
      )
      .eq("requires_ack", true)
      .lte("publish_at", new Date().toISOString())
      .order("publish_at", { ascending: false })
      .limit(5),
    supabase
      .from("announcement_acknowledgment")
      .select("announcement_id")
      .eq("user_id", userId),
    supabase
      .from("activity_event")
      .select(
        "id, actor_id, verb, source_type, source_id, summary, created_at, actor:actor_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const healthCounts: Record<string, number> = {};
  for (const row of healthRes.data ?? []) {
    healthCounts[row.health] = (healthCounts[row.health] ?? 0) + 1;
  }

  // Second wave: reference-dashboard surfaces (Today, program health,
  // activity charts, events, announcements rail).
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400_000).toISOString();
  const [
    todayTasksRes,
    todayMeetingsRes,
    upcomingEventsRes,
    programsRes2,
    programTasksRes,
    completedTasksRes,
    annChannelRes,
    activeMembersRes,
  ] = await Promise.all([
    supabase
      .from("task")
      .select(TASK_SELECT)
      .eq("assignee_id", userId)
      .in("status", OPEN_STATUSES)
      .is("archived_at", null)
      .lte("due_at", today)
      .order("due_at")
      .limit(6),
    supabase
      .from("meeting")
      .select(
        "id, program_id, project_id, title, purpose, organizer_id, starts_at, ends_at, location, meeting_link, status, notes, channel_id, project:project_id(id, name)",
      )
      .gte("starts_at", `${today}T00:00:00Z`)
      .lt("starts_at", new Date(Date.now() + 86400_000).toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(4),
    supabase
      .from("event")
      .select(
        "id, program_id, project_id, name, description, owner_id, event_type, starts_at, ends_at, location, status, volunteer_need",
      )
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(4),
    supabase
      .from("program")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .limit(8),
    supabase
      .from("task")
      .select("id, program_id, status")
      .is("archived_at", null)
      .not("program_id", "is", null),
    supabase
      .from("task")
      .select("id, completed_at")
      .eq("status", "completed")
      .gte("completed_at", sixtyDaysAgo),
    supabase
      .from("channel")
      .select("id")
      .eq("type", "announcements")
      .eq("is_mandatory", true)
      .maybeSingle(),
    supabase
      .from("organization_membership")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
  ]);

  const { data: openTaskRows } = await supabase
    .from("task")
    .select("status, due_at")
    .in("status", OPEN_STATUSES)
    .is("archived_at", null)
    .limit(1000);

  // Mutually exclusive donut buckets: overdue trumps status; otherwise
  // started vs not-started; completed counts the last 30 days.
  let donutInProgress = 0;
  let donutToDo = 0;
  let donutOverdue = 0;
  for (const row of openTaskRows ?? []) {
    if (row.due_at && (row.due_at as string) < today) donutOverdue += 1;
    else if (row.status === "not_started" || row.status === "ready") donutToDo += 1;
    else donutInProgress += 1;
  }

  // Program health: completion % of the program's tasks, downgraded by
  // blocked work. Explainable, documented signal (WORK-007).
  const programHealth: ProgramHealthRow[] = (
    (programsRes2.data ?? []) as { id: string; name: string }[]
  ).map((program) => {
    const tasks = (programTasksRes.data ?? []).filter(
      (t) => t.program_id === program.id,
    );
    const completed = tasks.filter((t) => t.status === "completed").length;
    const blocked = tasks.filter((t) => t.status === "blocked").length;
    const percent = tasks.length > 0 ? (completed / tasks.length) * 100 : 0;
    const statusLabel =
      tasks.length === 0
        ? "No projects"
        : blocked > 0 || percent < 35
          ? "At risk"
          : percent < 60
            ? "Needs attention"
            : "On track";
    return {
      id: program.id,
      name: program.name,
      completionPercent: percent,
      totalTasks: tasks.length,
      statusLabel,
      tone:
        statusLabel === "On track"
          ? "good"
          : statusLabel === "Needs attention"
            ? "attention"
            : statusLabel === "At risk"
              ? "risk"
              : "neutral",
    };
  });

  // Weekly completion series (last 8 ISO weeks).
  const weeklyCompleted: { label: string; value: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.now() - (i + 1) * 7 * 86400_000);
    const end = new Date(Date.now() - i * 7 * 86400_000);
    const count = (completedTasksRes.data ?? []).filter((t) => {
      if (!t.completed_at) return false;
      const at = new Date(t.completed_at as string);
      return at >= start && at < end;
    }).length;
    weeklyCompleted.push({
      label: `${end.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`,
      value: count,
    });
  }
  const completedPrevious30 = (completedTasksRes.data ?? []).filter((t) => {
    if (!t.completed_at) return false;
    const at = new Date(t.completed_at as string).getTime();
    return at < Date.now() - 30 * 86400_000;
  }).length;

  // Announcements rail: latest announcement with acknowledgment progress.
  let announcementRail: AnnouncementRail = {
    channelId: (annChannelRes.data?.id as string | undefined) ?? null,
    latest: null,
    recentMessages: [],
  };
  if (annChannelRes.data) {
    const [latestAnnRes, recentMsgRes] = await Promise.all([
      supabase
        .from("announcement")
        .select(
          "id, message_id, title, priority, requires_ack, ack_deadline, publish_at, expires_at, created_by, created_at, " +
            "message:message_id(id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at), " +
            "author:created_by(id, full_name, email, avatar_url, title, timezone)",
        )
        .lte("publish_at", new Date().toISOString())
        .order("publish_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("message")
        .select(
          "id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at, " +
            "author:author_id(id, full_name, email, avatar_url, title, timezone), reactions:message_reaction(message_id, user_id, emoji)",
        )
        .eq("channel_id", annChannelRes.data.id)
        .is("thread_root_id", null)
        .order("created_at", { ascending: false })
        .limit(4),
    ]);

    if (latestAnnRes.data) {
      const ann = latestAnnRes.data as unknown as Announcement & {
        author?: { full_name: string } | null;
      };
      const [{ count: ackCount }, { data: myAck }] = await Promise.all([
        supabase
          .from("announcement_acknowledgment")
          .select("user_id", { count: "exact", head: true })
          .eq("announcement_id", ann.id),
        supabase
          .from("announcement_acknowledgment")
          .select("user_id")
          .eq("announcement_id", ann.id)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      announcementRail = {
        channelId: annChannelRes.data.id as string,
        latest: {
          ...ann,
          ackCount: ackCount ?? 0,
          totalRecipients: activeMembersRes.count ?? 0,
          acknowledgedByMe: Boolean(myAck),
          authorName: ann.author?.full_name ?? "Leadership",
        },
        recentMessages: (
          (recentMsgRes.data ?? []) as unknown as Message[]
        ).reverse(),
      };
    } else {
      announcementRail.recentMessages = (
        (recentMsgRes.data ?? []) as unknown as Message[]
      ).reverse();
    }
  }

  const ackedIds = new Set(
    (myAcksRes.data ?? []).map((a) => a.announcement_id as string),
  );
  const requiredAnnouncements = (
    (announcementsRes.data ?? []) as unknown as Announcement[]
  ).filter(
    (a) =>
      !ackedIds.has(a.id) &&
      (!a.expires_at || new Date(a.expires_at) > new Date()),
  );

  return {
    kpis: {
      activePrograms: programsRes.count ?? 0,
      activeProjects: projectsRes.count ?? 0,
      openTasks: openTasksRes.count ?? 0,
      dueThisWeek: dueWeekRes.count ?? 0,
      overdue: overdueRes.count ?? 0,
      completedLast30: completedRes.count ?? 0,
    },
    healthCounts,
    attention: {
      overdueTasks: (overdueTasksRes.data ?? []) as unknown as Task[],
      blockedTasks: (blockedTasksRes.data ?? []) as unknown as Task[],
      unassignedTasks: (unassignedTasksRes.data ?? []) as unknown as Task[],
      riskyProjects: (riskyProjectsRes.data ?? []) as unknown as Project[],
    },
    requiredAnnouncements,
    recentActivity: (activityRes.data ?? []) as unknown as ActivityEvent[],
    todayTasks: (todayTasksRes.data ?? []) as unknown as Task[],
    todayMeetings: (todayMeetingsRes.data ?? []) as unknown as Meeting[],
    upcomingEvents: (upcomingEventsRes.data ?? []) as unknown as EventRecord[],
    programHealth,
    weeklyCompleted,
    statusBreakdown: {
      completed: completedRes.count ?? 0,
      inProgress: donutInProgress,
      toDo: donutToDo,
      overdue: donutOverdue,
    },
    completedPrevious30,
    announcementRail,
  };
}
