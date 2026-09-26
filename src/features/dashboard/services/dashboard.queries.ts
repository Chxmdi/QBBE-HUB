import { summarizeProjectHealth } from "../health";
import {
  DEFAULT_TIME_ZONE,
  addCalendarDays,
  calendarDateInZone,
  startOfDayInstant,
} from "@/lib/time";
import { createSupabasePageClient } from "@/lib/supabase/page";
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
import { isProjectStale, nextReportingDueOn } from "@/features/projects/stale";

export interface AttentionItem {
  id: string;
  title: string;
  reason: string;
  href: string;
}

export interface ProgramHealthRow {
  id: string;
  name: string;
  completionPercent: number;
  totalTasks: number;
  statusLabel: "On track" | "Off track" | "At risk" | "No projects" | "Not assessed";
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
    overdueMilestones: AttentionItem[];
    pendingDecisions: AttentionItem[];
    upcomingCommitments: AttentionItem[];
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
export async function getDashboardData(
  userId: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Promise<DashboardData> {
  const supabase = await createSupabasePageClient();

  // "Today" is a question about the organization's calendar, not the server's.
  // This previously read `new Date().toISOString().slice(0, 10)` — the host's
  // UTC date — and after 20:00 in Montreal the host is already on tomorrow, so
  // every panel below rolled over five hours early: "Due today" showed
  // tomorrow's work and the overdue count swallowed today's.
  const now = new Date();
  const today = calendarDateInZone(now, timeZone) ?? now.toISOString().slice(0, 10);
  const weekOut = addCalendarDays(today, 7) ?? today;
  const plus14 = addCalendarDays(today, 14) ?? today;
  const monthAgo = new Date(now.getTime() - 30 * 86400_000).toISOString();

  // `due_at` is a `date`, so the strings above compare against it directly.
  // `starts_at` is a `timestamptz` and needs the instants the local day spans —
  // which are not 24 hours apart on the two days a year the offset changes.
  const dayStart = startOfDayInstant(today, timeZone) ?? now;
  const dayEnd =
    startOfDayInstant(addCalendarDays(today, 1) ?? today, timeZone) ??
    new Date(now.getTime() + 86400_000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400_000).toISOString();

  // Second wave: reference-dashboard surfaces (Today, program health,
  // activity charts, events, announcements rail). It needs nothing from
  // the first, so it starts now rather than after it (#115).
  const secondWave = Promise.all([
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
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
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
      .select("id, name, projects:project(health, stage, archived_at)")
      .eq("status", "active")
      .order("name")
      .limit(8),
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

  const [
    programsRes,
    projectsRes,
    taskSummaryRes,
    healthRes,
    overdueTasksRes,
    blockedTasksRes,
    unassignedTasksRes,
    riskyProjectsRes,
    announcementsRes,
    myAcksRes,
    activityRes,
    overdueMilestonesRes,
    pendingDecisionsRes,
    upcomingMilestonesRes,
    upcomingFollowUpsRes,
    reportingProjectsRes,
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
    // Every task figure on the page in one pass over the readable tasks,
    // rather than a separate scan per number (#115). Same filters as before;
    // row-level security still limits each figure to what the viewer can read.
    supabase
      .rpc("dashboard_task_summary", {
        p_today: today,
        p_week_out: weekOut,
        p_month_ago: monthAgo,
        p_sixty_days_ago: sixtyDaysAgo,
      })
      .single(),
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
      .select("id, name, health, health_reason, stage, target_date, owner:owner_id(id, full_name, avatar_url)")
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
        "id, actor_id, verb, source_type, source_id, summary, created_at, actor:actor_id(id, full_name, avatar_url)",
      )
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("milestone")
      .select("id, name, due_date, project_id")
      .lt("due_date", today)
      .is("completed_at", null)
      .order("due_date")
      .limit(5),
    supabase
      .from("decision_request")
      .select("id, context, due_at, project_id")
      .eq("status", "open")
      .order("due_at")
      .limit(5),
    supabase
      .from("milestone")
      .select("id, name, due_date, project_id")
      .gte("due_date", today)
      .lte("due_date", plus14)
      .is("completed_at", null)
      .order("due_date")
      .limit(5),
    supabase
      .from("crm_follow_up")
      .select("id, title, due_at, crm_organization_id")
      .eq("status", "open")
      .gte("due_at", today)
      .lte("due_at", plus14)
      .order("due_at")
      .limit(5),
    supabase
      .from("project")
      .select("id, name, reporting_cadence, last_status_update_at, created_at, stage, archived_at")
      .in("reporting_cadence", ["weekly", "monthly"])
      .is("archived_at", null)
      .limit(20),
  ]);

  const healthCounts: Record<string, number> = {};
  for (const row of healthRes.data ?? []) {
    healthCounts[row.health] = (healthCounts[row.health] ?? 0) + 1;
  }

  const [
    todayTasksRes,
    todayMeetingsRes,
    upcomingEventsRes,
    programsRes2,
    annChannelRes,
    activeMembersRes,
  ] = await secondWave;

  // Mutually exclusive donut buckets, counted by dashboard_task_summary:
  // overdue trumps status; otherwise not-started (and ready) vs started;
  // completed counts the last 30 days. The donut used to count at most the
  // first 1,000 open tasks; it now counts all of them.
  const taskSummary = (taskSummaryRes.data ?? null) as {
    open_tasks: number;
    due_this_week: number;
    overdue: number;
    completed_last_30: number;
    donut_to_do: number;
    donut_in_progress: number;
    completed_at_since_sixty_days: string[] | null;
  } | null;
  const completedAtSinceSixtyDays = taskSummary?.completed_at_since_sixty_days ?? [];

  // Completion and owner-assessed health are separate signals (PRD §16.1).
  // Completion is counted in the database for the programs shown, rather than
  // by downloading every program task to count here: that list was the whole
  // workspace's tasks on every dashboard load, and past 1,000 rows it was also
  // silently cut short by the API's row cap (#115).
  const shownPrograms = (programsRes2.data ?? []) as {
    id: string;
    name: string;
    projects: { health: string; stage: string; archived_at: string | null }[];
  }[];
  // The announcements rail and the program counts are independent reads,
  // so they run side by side.
  const announcementRailPromise = (async (): Promise<AnnouncementRail> => {
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
              "author:created_by(id, full_name, avatar_url)",
          )
          .lte("publish_at", new Date().toISOString())
          .order("publish_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("message")
          .select(
            "id, channel_id, conversation_id, thread_root_id, author_id, body, is_system, created_at, edited_at, deleted_at, " +
              "author:author_id(id, full_name, avatar_url), reactions:message_reaction(message_id, user_id, emoji)",
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
    return announcementRail;
  })();

  const programTaskCounts = await Promise.all(
    shownPrograms.map(async (program) => {
      const tasksIn = () =>
        supabase
          .from("task")
          .select("id", { count: "exact", head: true })
          .eq("program_id", program.id)
          .is("archived_at", null);
      const [all, completed] = await Promise.all([
        tasksIn(),
        tasksIn().eq("status", "completed"),
      ]);
      return { total: all.count ?? 0, completed: completed.count ?? 0 };
    }),
  );
  const programHealth: ProgramHealthRow[] = shownPrograms.map((program, index) => {
    const { total, completed } = programTaskCounts[index];
    const percent = total > 0 ? (completed / total) * 100 : 0;
    return {
      id: program.id,
      name: program.name,
      completionPercent: percent,
      totalTasks: total,
      ...summarizeProjectHealth(program.projects ?? []),
    };
  });

  // Weekly completion series (last 8 ISO weeks).
  const weeklyCompleted: { label: string; value: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(Date.now() - (i + 1) * 7 * 86400_000);
    const end = new Date(Date.now() - i * 7 * 86400_000);
    const count = completedAtSinceSixtyDays.filter((completedAt) => {
      const at = new Date(completedAt);
      return at >= start && at < end;
    }).length;
    weeklyCompleted.push({
      label: `${end.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`,
      value: count,
    });
  }
  const completedPrevious30 = completedAtSinceSixtyDays.filter(
    (completedAt) => new Date(completedAt).getTime() < Date.now() - 30 * 86400_000,
  ).length;

  // Announcements rail: latest announcement with acknowledgment progress.

  const announcementRail = await announcementRailPromise;

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
      openTasks: Number(taskSummary?.open_tasks ?? 0),
      dueThisWeek: Number(taskSummary?.due_this_week ?? 0),
      overdue: Number(taskSummary?.overdue ?? 0),
      completedLast30: Number(taskSummary?.completed_last_30 ?? 0),
    },
    healthCounts,
    attention: {
      overdueTasks: (overdueTasksRes.data ?? []) as unknown as Task[],
      blockedTasks: (blockedTasksRes.data ?? []) as unknown as Task[],
      unassignedTasks: (unassignedTasksRes.data ?? []) as unknown as Task[],
      riskyProjects: (riskyProjectsRes.data ?? []) as unknown as Project[],
      overdueMilestones: (overdueMilestonesRes.data ?? []).map((row) => ({
        id: row.id as string,
        title: row.name as string,
        reason: `Due ${row.due_date as string}`,
        href: `/projects/${row.project_id}`,
      })),
      pendingDecisions: (pendingDecisionsRes.data ?? []).map((row) => ({
        id: row.id as string,
        title: row.context as string,
        reason: `Decide by ${row.due_at as string}`,
        href: `/projects/${row.project_id}?tab=risks`,
      })),
      upcomingCommitments: [
        ...(upcomingMilestonesRes.data ?? []).map((row) => ({
          id: row.id as string,
          title: row.name as string,
          reason: `Milestone · ${row.due_date as string}`,
          href: `/projects/${row.project_id}`,
        })),
        ...(upcomingFollowUpsRes.data ?? []).map((row) => ({
          id: row.id as string,
          title: row.title as string,
          reason: `Follow-up · ${row.due_at as string}`,
          href: `/crm/${row.crm_organization_id}`,
        })),
        ...((reportingProjectsRes.data ?? []) as {
          id: string;
          name: string;
          reporting_cadence: string | null;
          last_status_update_at: string | null;
          created_at: string;
          stage: string;
          archived_at: string | null;
        }[])
          .map((project) => {
            const due = nextReportingDueOn(project, now);
            if (!due || due > plus14) return null;
            return {
              id: `report-${project.id}`,
              title: project.name,
              reason: isProjectStale(project, now)
                ? "Reporting date overdue"
                : `Report due ${due}`,
              href: `/projects/${project.id}?tab=updates`,
            };
          })
          .filter((item): item is AttentionItem => item !== null),
      ].slice(0, 8),
    },
    requiredAnnouncements,
    recentActivity: (activityRes.data ?? []) as unknown as ActivityEvent[],
    todayTasks: (todayTasksRes.data ?? []) as unknown as Task[],
    todayMeetings: (todayMeetingsRes.data ?? []) as unknown as Meeting[],
    upcomingEvents: (upcomingEventsRes.data ?? []) as unknown as EventRecord[],
    programHealth,
    weeklyCompleted,
    statusBreakdown: {
      completed: Number(taskSummary?.completed_last_30 ?? 0),
      inProgress: Number(taskSummary?.donut_in_progress ?? 0),
      toDo: Number(taskSummary?.donut_to_do ?? 0),
      overdue: Number(taskSummary?.overdue ?? 0),
    },
    completedPrevious30,
    announcementRail,
  };
}
