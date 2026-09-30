import type { TaskPriority, TaskStatus } from "@/types/entities";
import type { AttentionScore } from "./attention";

/**
 * What Home reads (M17). Every row comes through the viewer's own client, so
 * row-level security has already decided what is here; Home only sorts it.
 */

export interface HomeTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Calendar date (YYYY-MM-DD) or null. */
  due_at: string | null;
  assignee_id: string | null;
  requester_id: string | null;
  reviewer_id: string | null;
  approver_id: string | null;
  project_id: string | null;
  blocked_reason: string | null;
  updated_at: string;
  project?: { id: string; name: string } | null;
  assignee?: { full_name: string } | null;
}

export interface HomeMeeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  status: string;
  organizer_id: string | null;
}

export interface HomeProject {
  id: string;
  name: string;
  stage: string;
  health: string;
  priority: TaskPriority;
  target_date: string | null;
  owner_id: string | null;
  sponsor_id: string | null;
  updated_at: string;
}

export interface HomeApproval {
  id: string;
  note: string | null;
  due_at: string | null;
  created_at: string;
  requested_by: string;
  project_request_id: string | null;
  report_id: string | null;
  opportunity_id: string | null;
}

export interface HomeDecision {
  id: string;
  title: string;
  decided_at: string;
  project_id: string | null;
  meeting_id: string | null;
}

export interface HomeActivity {
  id: string;
  actor_id: string | null;
  verb: string;
  source_type: string;
  source_id: string;
  project_id: string | null;
  summary: string;
  created_at: string;
  actor?: { full_name: string } | null;
}

export interface HomeMention {
  id: string;
  source_type?: string | null;
  source_id?: string | null;
  project_id?: string | null;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface HomeData {
  userId: string;
  /** "Now", in the organization's zone. */
  now: Date;
  timeZone: string;
  /** Open tasks the viewer is assigned to, requested, reviews or approves. */
  tasks: HomeTask[];
  meetings: HomeMeeting[];
  projects: HomeProject[];
  approvals: HomeApproval[];
  decisions: HomeDecision[];
  /** Recent activity by the viewer (Continue) and by others (Changes). */
  activity: HomeActivity[];
  mentions: HomeMention[];
  /** Open tasks blocked by one of the viewer's tasks (task_dependency). */
  dependencies: { blocking_task_id: string; blocked_task_id: string }[];
}

/** One line on Home: what it is, where it goes, and the facts shown under it. */
export interface HomeItem {
  key: string;
  kind: "task" | "meeting" | "project" | "approval" | "decision" | "activity" | "mention";
  id: string;
  title: string;
  href: string;
  /** Short facts, already worked out, for the component to label and format. */
  facts: HomeFact[];
  /** The attention score and its reasons, on the items Now ranks (M17c). */
  attention?: AttentionScore;
}

export type HomeFact =
  | { kind: "due"; date: string; overdue: boolean; today: boolean }
  | { kind: "status"; status: TaskStatus }
  | { kind: "project"; name: string }
  | { kind: "time"; at: string }
  | { kind: "person"; name: string }
  | { kind: "reason"; text: string }
  | { kind: "role"; role: "reviewer" | "approver" | "requester" | "owner" }
  | { kind: "health"; health: string }
  | { kind: "summary"; text: string };

export const OPEN_STATUSES: readonly TaskStatus[] = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
];

export function isOpen(task: Pick<HomeTask, "status">): boolean {
  return OPEN_STATUSES.includes(task.status);
}
