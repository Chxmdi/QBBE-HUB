import { addCalendarDays, calendarDateInZone } from "@/lib/time";
import { rankByAttention, type AttentionInput } from "./attention";
import {
  isOpen,
  type HomeActivity,
  type HomeData,
  type HomeFact,
  type HomeItem,
  type HomeMeeting,
  type HomeProject,
  type HomeTask,
} from "./model";

/**
 * Home's sections (M17a) and My World (M17b), sorted by fixed rules from rows
 * the viewer can already see. Pure: the same data and clock give the same
 * page, which is what the unit tests hold it to.
 */

export const SECTION_KEYS = ["now", "today", "waiting", "continue", "decisions", "changes"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type HomeSections = Record<SectionKey, HomeItem[]>;

export const WORLD_KEYS = ["tasks", "meetings", "projects", "waitingOn", "mentions", "decisionsNeeded"] as const;
export type WorldKey = (typeof WORLD_KEYS)[number];
export type MyWorld = Record<WorldKey, HomeItem[]>;

const LIMITS: Record<SectionKey, number> = {
  now: 5,
  today: 10,
  waiting: 8,
  continue: 6,
  decisions: 8,
  changes: 8,
};

/** How far back Continue and Changes look. */
export const CONTINUE_DAYS = 14;
export const CHANGES_DAYS = 3;

export function taskHref(id: string): string {
  return `/my-work?task=${id}`;
}

const SOURCE_ROUTES: Partial<Record<string, (id: string) => string>> = {
  task: taskHref,
  project: (id) => `/projects/${id}`,
  meeting: (id) => `/meetings/${id}`,
  document: (id) => `/documents/${id}`,
  event: (id) => `/events/${id}`,
  program: (id) => `/programs/${id}`,
};

export function activityHref(activity: Pick<HomeActivity, "source_type" | "source_id" | "project_id">): string {
  const route = SOURCE_ROUTES[activity.source_type];
  if (route) return route(activity.source_id);
  return activity.project_id ? `/projects/${activity.project_id}` : "/";
}

interface Clock {
  today: string;
  inDays: (days: number) => string;
  msAgo: (iso: string) => number;
}

function clock(data: HomeData): Clock {
  const today = calendarDateInZone(data.now, data.timeZone) ?? data.now.toISOString().slice(0, 10);
  return {
    today,
    inDays: (days) => addCalendarDays(today, days) ?? today,
    msAgo: (iso) => data.now.getTime() - new Date(iso).getTime(),
  };
}

const DAY_MS = 86_400_000;

function dueFact(task: HomeTask, time: Clock): HomeFact[] {
  if (!task.due_at) return [];
  const date = task.due_at.slice(0, 10);
  return [{ kind: "due", date, overdue: date < time.today, today: date === time.today }];
}

export function taskItem(task: HomeTask, time: Clock, extra: HomeFact[] = []): HomeItem {
  return {
    key: `task:${task.id}`,
    kind: "task",
    id: task.id,
    title: task.title,
    href: taskHref(task.id),
    facts: [
      ...dueFact(task, time),
      { kind: "status", status: task.status },
      ...(task.project ? [{ kind: "project" as const, name: task.project.name }] : []),
      ...extra,
    ],
  };
}

function meetingItem(meeting: HomeMeeting): HomeItem {
  return {
    key: `meeting:${meeting.id}`,
    kind: "meeting",
    id: meeting.id,
    title: meeting.title,
    href: `/meetings/${meeting.id}`,
    facts: [{ kind: "time", at: meeting.starts_at }],
  };
}

function projectItem(project: HomeProject, role: "owner" | null): HomeItem {
  return {
    key: `project:${project.id}`,
    kind: "project",
    id: project.id,
    title: project.name,
    href: `/projects/${project.id}`,
    facts: [
      { kind: "health", health: project.health },
      ...(project.target_date
        ? [{ kind: "due" as const, date: project.target_date, overdue: false, today: false }]
        : []),
      ...(role ? [{ kind: "role" as const, role }] : []),
    ],
  };
}

function activityItem(activity: HomeActivity): HomeItem {
  return {
    key: `activity:${activity.id}`,
    kind: "activity",
    id: activity.id,
    title: activity.summary,
    href: activityHref(activity),
    facts: [
      ...(activity.actor ? [{ kind: "person" as const, name: activity.actor.full_name }] : []),
      { kind: "time", at: activity.created_at },
    ],
  };
}

/** Soonest due first, undated last, then title, then id: a total order. */
export function byDue(a: HomeTask, b: HomeTask): number {
  const ad = a.due_at ?? "9999-12-31";
  const bd = b.due_at ?? "9999-12-31";
  return ad.localeCompare(bd) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function mine(data: HomeData): HomeTask[] {
  return data.tasks.filter((task) => task.assignee_id === data.userId && isOpen(task));
}

/** An item needs to reach this attention score to be in Now. */
export const NOW_THRESHOLD = 30;

const RECENT_MS = 2 * DAY_MS;

/**
 * The attention inputs for my open tasks and my projects (M17c): the facts
 * the rules in ./attention.ts score, counted from rows already loaded.
 */
export function attentionCandidates(data: HomeData): { item: HomeItem; input: AttentionInput }[] {
  const time = clock(data);
  const projects = new Map(data.projects.map((project) => [project.id, project]));
  const myTasks = mine(data);
  const unread = data.mentions.filter((mention) => !mention.read_at);
  const changesBy = (id: string, type: string) =>
    data.activity.filter(
      (activity) =>
        activity.actor_id !== data.userId &&
        activity.source_type === type &&
        activity.source_id === id &&
        time.msAgo(activity.created_at) <= RECENT_MS,
    ).length;

  const tasks = myTasks.map((task) => {
    const project = task.project_id ? projects.get(task.project_id) : undefined;
    const input: AttentionInput = {
      kind: "task",
      id: task.id,
      title: task.title,
      due: task.due_at?.slice(0, 10) ?? null,
      status: task.status,
      taskPriority: task.priority,
      project: project ? { name: project.name, target: project.target_date, priority: project.priority } : null,
      role: "assignee",
      // Dependencies arrive already limited to open blocked tasks. Only the
      // count is shown, never the blocked task itself.
      blocks: data.dependencies.filter((dependency) => dependency.blocking_task_id === task.id).length,
      unreadMentions: unread.filter((mention) => mention.source_id === task.id).length,
      recentChanges: changesBy(task.id, "task"),
    };
    return { item: taskItem(task, time), input };
  });

  const projectItems = data.projects
    .filter((project) => project.owner_id === data.userId || project.sponsor_id === data.userId || myTasks.some((task) => task.project_id === project.id))
    .map((project) => {
      const input: AttentionInput = {
        kind: "project",
        id: project.id,
        title: project.name,
        due: project.target_date,
        project: { name: project.name, target: null, priority: project.priority },
        role: project.owner_id === data.userId ? "owner" : project.sponsor_id === data.userId ? "sponsor" : null,
        blocks: myTasks.filter((task) => task.project_id === project.id).length,
        unreadMentions: unread.filter((mention) => mention.source_id === project.id || mention.project_id === project.id).length,
        recentChanges: changesBy(project.id, "project"),
      };
      return { item: projectItem(project, input.role === "owner" ? "owner" : null), input };
    });

  return [...tasks, ...projectItems];
}

/** Now: my tasks and projects that need attention, highest score first (M17c). */
export function nowItems(data: HomeData): HomeItem[] {
  const time = clock(data);
  return rankByAttention(attentionCandidates(data), time.today)
    .filter((entry) => entry.attention.score >= NOW_THRESHOLD)
    .map((entry) => ({ ...entry.item, attention: entry.attention }));
}

/** Waiting: open work somebody else holds that I asked for, and my own blocked or waiting tasks. */
export function waitingTasks(data: HomeData): HomeTask[] {
  const asked = data.tasks.filter(
    (task) => isOpen(task) && task.requester_id === data.userId && task.assignee_id !== data.userId && task.assignee_id !== null,
  );
  const stuck = mine(data).filter((task) => task.status === "blocked" || task.status === "waiting");
  return [...stuck, ...asked.filter((task) => !stuck.includes(task))].sort(byDue);
}

/** Decisions needed from me: approvals and task reviews waiting on me. */
export function decisionsNeeded(data: HomeData): HomeItem[] {
  const time = clock(data);
  const approvals: HomeItem[] = [...data.approvals]
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") || a.created_at.localeCompare(b.created_at))
    .map((approval) => ({
      key: `approval:${approval.id}`,
      kind: "approval",
      id: approval.id,
      title: approval.note?.split("\n")[0] || "",
      href: "/approvals",
      facts: [
        ...(approval.due_at
          ? [{ kind: "due" as const, date: approval.due_at, overdue: approval.due_at < time.today, today: approval.due_at === time.today }]
          : []),
        { kind: "role", role: "approver" },
      ],
    }));
  const reviews = data.tasks
    .filter(
      (task) =>
        task.status === "in_review" &&
        (task.reviewer_id === data.userId || task.approver_id === data.userId) &&
        task.assignee_id !== data.userId,
    )
    .sort(byDue)
    .map((task) =>
      taskItem(task, time, [{ kind: "role", role: task.reviewer_id === data.userId ? "reviewer" : "approver" }]),
    );
  return [...approvals, ...reviews];
}

export function buildHomeSections(data: HomeData): HomeSections {
  const time = clock(data);

  const now = nowItems(data);
  const nowIds = new Set(now.map((item) => item.id));

  const todaysMeetings = data.meetings
    .filter((meeting) => meeting.status !== "cancelled" && calendarDateInZone(new Date(meeting.starts_at), data.timeZone) === time.today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
    .map(meetingItem);
  const dueToday = mine(data)
    .filter((task) => task.due_at?.slice(0, 10) === time.today)
    .sort(byDue)
    .map((task) => taskItem(task, time));
  const today = [...todaysMeetings, ...dueToday];

  const waiting = waitingTasks(data).map((task) =>
    taskItem(task, time, [
      ...(task.assignee_id !== data.userId && task.assignee ? [{ kind: "person" as const, name: task.assignee.full_name }] : []),
      ...(task.blocked_reason ? [{ kind: "reason" as const, text: task.blocked_reason }] : []),
    ]),
  );

  // Continue: the last things I worked on, one line per record, newest first.
  const seen = new Set<string>();
  const cont: HomeItem[] = [];
  for (const activity of [...data.activity].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (activity.actor_id !== data.userId) continue;
    if (time.msAgo(activity.created_at) > CONTINUE_DAYS * DAY_MS) continue;
    const key = `${activity.source_type}:${activity.source_id}`;
    if (seen.has(key) || nowIds.has(activity.source_id)) continue;
    seen.add(key);
    const task = activity.source_type === "task" ? data.tasks.find((candidate) => candidate.id === activity.source_id) : undefined;
    if (activity.source_type === "task" && !task) continue; // finished or no longer visible
    cont.push(task ? taskItem(task, time) : activityItem(activity));
  }

  const recentDecisions: HomeItem[] = [...data.decisions]
    .filter((decision) => time.msAgo(decision.decided_at) <= CONTINUE_DAYS * DAY_MS)
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at) || a.id.localeCompare(b.id))
    .map((decision) => ({
      key: `decision:${decision.id}`,
      kind: "decision",
      id: decision.id,
      title: decision.title,
      href: decision.project_id
        ? `/projects/${decision.project_id}`
        : decision.meeting_id
          ? `/meetings/${decision.meeting_id}`
          : "/",
      facts: [{ kind: "time", at: decision.decided_at }],
    }));

  const changes = data.activity
    .filter((activity) => activity.actor_id !== data.userId && time.msAgo(activity.created_at) <= CHANGES_DAYS * DAY_MS)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map(activityItem);

  const sections: HomeSections = {
    now,
    today,
    waiting,
    continue: cont,
    decisions: [...decisionsNeeded(data), ...recentDecisions],
    changes,
  };
  for (const key of SECTION_KEYS) sections[key] = sections[key].slice(0, LIMITS[key]);
  return sections;
}

export function buildMyWorld(data: HomeData): MyWorld {
  const time = clock(data);
  const horizon = time.inDays(14);
  const projectIds = new Set(mine(data).map((task) => task.project_id).filter(Boolean));
  return {
    tasks: mine(data).sort(byDue).map((task) => taskItem(task, time)),
    meetings: data.meetings
      .filter((meeting) => {
        const day = calendarDateInZone(new Date(meeting.starts_at), data.timeZone) ?? "";
        return meeting.status !== "cancelled" && day >= time.today && day < horizon;
      })
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
      .map(meetingItem),
    projects: data.projects
      .filter((project) => project.owner_id === data.userId || project.sponsor_id === data.userId || projectIds.has(project.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((project) => projectItem(project, project.owner_id === data.userId ? "owner" : null)),
    waitingOn: waitingTasks(data)
      .filter((task) => task.assignee_id !== data.userId)
      .map((task) => taskItem(task, time, task.assignee ? [{ kind: "person", name: task.assignee.full_name }] : [])),
    mentions: [...data.mentions]
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .map((mention) => ({
        key: `mention:${mention.id}`,
        kind: "mention",
        id: mention.id,
        title: mention.title,
        href: mention.link ?? "/inbox",
        facts: [
          ...(mention.body ? [{ kind: "summary" as const, text: mention.body.split("\n")[0] }] : []),
          { kind: "time", at: mention.created_at },
        ],
      })),
    decisionsNeeded: decisionsNeeded(data),
  };
}
