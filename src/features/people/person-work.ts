/**
 * One person's work (#136, phase 2): the shape `person_work_summary()`
 * returns, who may open the page, and how its figures feed the same
 * attention rules as the team overview.
 *
 * The page is the same for the person and for an owner or admin looking at
 * them, so staff see exactly what their manager sees. Everything comes from
 * work records; sign-ins and time online are never read.
 */

import type { TeamOverviewRow } from "./team-overview";

export type TaskGroup = "overdue" | "blocked" | "this_week" | "later";

/** The order the groups appear on the page, most pressing first. */
export const TASK_GROUPS: TaskGroup[] = ["overdue", "blocked", "this_week", "later"];

export interface PersonWorkTask {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  updated_at: string;
  project_id: string | null;
  project_name: string | null;
  group: TaskGroup;
  no_recent_update: boolean;
}

export interface PersonWorkProject {
  id: string;
  name: string;
  stage: string;
  health: string;
  reporting_cadence: string;
  last_status_update_at: string | null;
  created_at: string;
  report_overdue: boolean;
}

export interface PersonWorkDecision {
  id: string;
  context: string;
  due_at: string;
  project_id: string;
  project_name: string;
  overdue: boolean;
}

export interface PersonWorkAction {
  id: string;
  title: string;
  due_at: string | null;
  meeting_id: string;
  meeting_title: string;
  meeting_starts_at: string;
  task_id: string | null;
  overdue: boolean;
}

export interface PersonWorkActivity {
  id: string;
  verb: string;
  source_type: string;
  source_id: string;
  project_id: string | null;
  program_id: string | null;
  summary: string;
  created_at: string;
}

export interface PersonWorkFigures {
  open_tasks: number;
  overdue: number;
  oldest_overdue_due: string | null;
  due_this_week: number;
  blocked: number;
  blocked_stale: number;
  in_progress_stale: number;
  completed_7: number;
  completed_prev_7: number;
  completed_30: number;
  open_decisions: number;
  overdue_decisions: number;
  owned_projects: number;
  stale_projects: number;
  open_meeting_actions: number;
  last_activity_at: string | null;
}

export interface PersonWorkSummary {
  person: {
    user_id: string;
    organization_id: string;
    role: "owner" | "admin" | "staff";
    full_name: string;
    avatar_url: string | null;
    title: string | null;
  };
  thresholds: {
    overdue_count: number;
    overdue_age_days: number;
    blocked_no_update_days: number;
    in_progress_no_update_days: number;
    flag_project_reports: boolean;
    flag_overdue_decisions: boolean;
  };
  figures: PersonWorkFigures;
  tasks: PersonWorkTask[];
  projects: PersonWorkProject[];
  decisions: PersonWorkDecision[];
  meeting_actions: PersonWorkAction[];
  activity: PersonWorkActivity[];
  activity_has_more: boolean;
  activity_since: string;
}

export type PersonWorkAccess = "self" | "admin" | "denied";

/**
 * Who is asking. Staff (and owners and admins) may open their own summary;
 * only owners and admins may open someone else's, and they must also have
 * completed MFA, which the page checks next. Volunteers and guests have no
 * summary, not even their own. The database applies the same rule.
 */
export function personWorkAccess(viewer: {
  userId: string;
  isStaff: boolean;
  isAdmin: boolean;
  targetId: string;
}): PersonWorkAccess {
  if (viewer.targetId === viewer.userId) return viewer.isStaff ? "self" : "denied";
  return viewer.isAdmin ? "admin" : "denied";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** A timeline cursor from the query string, or null when absent or not a time. */
export function activityCursor(value: string | undefined): string | null {
  if (!value || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** Open tasks by group, in page order, with empty groups kept so each heading shows. */
export function groupTasks(tasks: PersonWorkTask[]): { group: TaskGroup; tasks: PersonWorkTask[] }[] {
  return TASK_GROUPS.map((group) => ({
    group,
    tasks: tasks.filter((task) => task.group === group),
  }));
}

/**
 * The figures as a team overview row, so the page can use the overview's
 * attentionReasons() and word each reason exactly as the overview does.
 */
export function asOverviewRow(summary: PersonWorkSummary): TeamOverviewRow {
  const f = summary.figures;
  return {
    user_id: summary.person.user_id,
    organization_id: summary.person.organization_id,
    role: summary.person.role,
    full_name: summary.person.full_name,
    avatar_url: summary.person.avatar_url,
    title: summary.person.title,
    open_tasks: Number(f.open_tasks),
    overdue: Number(f.overdue),
    oldest_overdue_due: f.oldest_overdue_due,
    due_this_week: Number(f.due_this_week),
    blocked: Number(f.blocked),
    blocked_stale: Number(f.blocked_stale),
    in_progress_stale: Number(f.in_progress_stale),
    completed_7: Number(f.completed_7),
    completed_prev_7: Number(f.completed_prev_7),
    completed_30: Number(f.completed_30),
    open_decisions: Number(f.open_decisions),
    overdue_decisions: Number(f.overdue_decisions),
    last_activity_at: f.last_activity_at,
  };
}

/** The person page itself, optionally opening one task in the task drawer. */
export function personWorkHref(userId: string, taskId?: string): string {
  return taskId ? `/people/${userId}/work?task=${taskId}` : `/people/${userId}/work`;
}

/** Where an activity entry leads, when it names something with its own page. */
export function activityHref(event: PersonWorkActivity, userId: string): string | null {
  if (event.source_type === "task") return personWorkHref(userId, event.source_id);
  if (event.source_type === "project") return `/projects/${event.source_id}`;
  if (event.source_type === "meeting") return `/meetings/${event.source_id}`;
  if (event.project_id) return `/projects/${event.project_id}`;
  if (event.program_id) return `/programs/${event.program_id}`;
  return null;
}
