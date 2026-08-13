/**
 * Application-level entity types mirroring supabase/migrations. Regenerate
 * richer types from the live schema with `npm run db:types` once a Supabase
 * project is linked (DB-010); these hand-maintained shapes cover the fields
 * the UI consumes.
 */

export type OrgRole = "owner" | "admin" | "staff" | "volunteer" | "guest";

export type ProjectStage =
  | "proposed"
  | "approved"
  | "planning"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived";

export type ProjectHealth =
  | "on_track"
  | "at_risk"
  | "off_track"
  | "paused"
  | "unknown";

export type TaskStatus =
  | "not_started"
  | "ready"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "in_review"
  | "completed"
  | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  title: string | null;
  timezone: string | null;
}

export interface Membership {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  status: "active" | "invited" | "deactivated";
  joined_at: string;
  user_profile?: Profile;
}

export interface Program {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  lead_id: string | null;
  status: "active" | "paused" | "archived";
  created_at: string;
  lead?: Profile | null;
}

export interface Project {
  id: string;
  program_id: string | null;
  name: string;
  outcome: string | null;
  description: string | null;
  owner_id: string | null;
  stage: ProjectStage;
  health: ProjectHealth;
  health_reason: string | null;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  archived_at: string | null;
  owner?: Profile | null;
  program?: Pick<Program, "id" | "name"> | null;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  due_date: string | null;
  completed_at: string | null;
  sort_key: number;
}

export interface Task {
  id: string;
  program_id: string | null;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  reviewer_id: string | null;
  start_at: string | null;
  due_at: string | null;
  blocked_reason: string | null;
  sort_key: number;
  completed_at: string | null;
  created_at: string;
  archived_at: string | null;
  assignee?: Profile | null;
  project?: Pick<Project, "id" | "name"> | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: Profile | null;
}

export interface ProjectStatusUpdate {
  id: string;
  project_id: string;
  author_id: string;
  health: ProjectHealth;
  progress_summary: string;
  next_steps: string | null;
  blockers: string | null;
  decisions_needed: string | null;
  help_requested: string | null;
  created_at: string;
  author?: Profile | null;
}

export interface ActivityEvent {
  id: string;
  actor_id: string | null;
  verb: string;
  source_type: string;
  source_id: string;
  summary: string;
  created_at: string;
  actor?: Profile | null;
}

export type ChannelType =
  | "organization"
  | "announcements"
  | "team"
  | "program"
  | "project"
  | "event"
  | "operations"
  | "leadership"
  | "custom";

export interface Channel {
  id: string;
  name: string;
  slug: string;
  type: ChannelType;
  privacy: "public" | "private";
  purpose: string | null;
  topic: string | null;
  owner_id: string | null;
  program_id: string | null;
  project_id: string | null;
  posting_policy: "everyone" | "staff" | "admins";
  reply_policy: "normal" | "threads_only" | "disabled";
  is_mandatory: boolean;
  archived_at: string | null;
  created_at: string;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  role: string;
  muted_level: string;
  last_read_at: string;
}

export interface Message {
  id: string;
  channel_id: string | null;
  conversation_id: string | null;
  thread_root_id: string | null;
  author_id: string;
  body: string;
  is_system: boolean;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  author?: Profile | null;
  reactions?: MessageReaction[];
  reply_count?: number;
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

export interface Announcement {
  id: string;
  message_id: string;
  title: string;
  priority: "normal" | "important" | "critical";
  requires_ack: boolean;
  ack_deadline: string | null;
  publish_at: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  message?: Message | null;
  author?: Profile | null;
  acknowledged?: boolean;
  ack_count?: number;
}

export interface Notification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  urgency: "low" | "normal" | "high" | "critical";
  read_at: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  is_group: boolean;
  title: string | null;
  created_at: string;
  members?: Profile[];
}

export interface Meeting {
  id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  purpose: string | null;
  organizer_id: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  meeting_link: string | null;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  notes: string | null;
  channel_id: string | null;
  organizer?: Profile | null;
  project?: Pick<Project, "id" | "name"> | null;
}

export interface AgendaItem {
  id: string;
  meeting_id: string;
  title: string;
  kind: "information" | "discussion" | "decision";
  owner_id: string | null;
  desired_outcome: string | null;
  time_box_minutes: number | null;
  sort_key: number;
  status: string;
  owner?: Profile | null;
}

export interface MeetingAction {
  id: string;
  meeting_id: string;
  task_id: string | null;
  title: string;
  owner_id: string | null;
  due_at: string | null;
  owner?: Profile | null;
}

export interface Decision {
  id: string;
  project_id: string | null;
  meeting_id: string | null;
  title: string;
  detail: string | null;
  decided_at: string;
  decided_by: string | null;
}

export interface EventRecord {
  id: string;
  program_id: string | null;
  project_id: string | null;
  name: string;
  description: string | null;
  owner_id: string | null;
  event_type: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  status: "planning" | "confirmed" | "in_progress" | "completed" | "cancelled";
  volunteer_need: number | null;
  owner?: Profile | null;
}

export interface CrmOrganization {
  id: string;
  name: string;
  category: string;
  website: string | null;
  owner_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  owner?: Profile | null;
}

export interface CrmContact {
  id: string;
  crm_organization_id: string | null;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;
  status: string;
}

export interface CrmInteraction {
  id: string;
  crm_organization_id: string;
  contact_id: string | null;
  interaction_type: string;
  occurred_at: string;
  owner_id: string;
  summary: string;
  next_steps: string | null;
  owner?: Profile | null;
}

export interface CrmFollowUp {
  id: string;
  crm_organization_id: string;
  owner_id: string;
  title: string;
  due_at: string;
  status: "open" | "done" | "cancelled";
  crm_organization?: Pick<CrmOrganization, "id" | "name"> | null;
}

export interface ReportInstance {
  id: string;
  report_type: string;
  title: string;
  program_id: string | null;
  project_id: string | null;
  period_start: string | null;
  period_end: string | null;
  snapshot: Record<string, unknown>;
  status: "draft" | "in_review" | "approved";
  generated_by: string;
  created_at: string;
}

export interface SearchResult {
  result_type: string;
  id: string;
  title: string;
  snippet: string;
  href: string;
}
