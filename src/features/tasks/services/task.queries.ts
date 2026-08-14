import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Task } from "@/types/entities";

export const TASK_SELECT =
  "id, program_id, project_id, milestone_id, title, description, status, priority, " +
  "assignee_id, reviewer_id, start_at, due_at, blocked_reason, sort_key, completed_at, " +
  "created_at, archived_at, " +
  "assignee:assignee_id(id, full_name, email, avatar_url, title, timezone), " +
  "project:project_id(id, name)";

const OPEN_STATUSES = [
  "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
];

export async function getMyTasks(userId: string): Promise<Task[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("task")
    .select(TASK_SELECT)
    .eq("assignee_id", userId)
    .is("archived_at", null)
    .in("status", OPEN_STATUSES)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  return (data ?? []) as unknown as Task[];
}

export async function getBoardTasks(projectId?: string): Promise<Task[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("task")
    .select(TASK_SELECT)
    .is("archived_at", null)
    .order("sort_key", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query;
  return (data ?? []) as unknown as Task[];
}

export interface TaskFilters {
  status?: string;
  priority?: string;
  project?: string;
  q?: string;
}

/** My Work with shareable URL-driven filters (P0-TSK-09, §10.2). */
export async function getMyTasksFiltered(
  userId: string,
  filters: TaskFilters,
): Promise<Task[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("task")
    .select(TASK_SELECT)
    .eq("assignee_id", userId)
    .is("archived_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(300);

  if (filters.status) query = query.eq("status", filters.status);
  else query = query.in("status", OPEN_STATUSES);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.project) query = query.eq("project_id", filters.project);
  if (filters.q) query = query.ilike("title", `%${filters.q}%`);

  const { data } = await query;
  return (data ?? []) as unknown as Task[];
}

export interface SelectOption {
  id: string;
  label: string;
}

/** Options for pickers: active projects and active people. */
export async function getPickerOptions(): Promise<{
  projects: SelectOption[];
  people: SelectOption[];
}> {
  const supabase = await createSupabaseServerClient();
  const [{ data: projects }, { data: members }] = await Promise.all([
    supabase
      .from("project")
      .select("id, name")
      .is("archived_at", null)
      .in("stage", ["approved", "planning", "active"])
      .order("name"),
    supabase
      .from("organization_membership")
      .select("user_id, status, user_profile:user_id(id, full_name)")
      .eq("status", "active"),
  ]);

  type MemberRow = { user_profile: { id: string; full_name: string } | null };

  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, label: p.name })),
    people: ((members ?? []) as unknown as MemberRow[])
      .filter((m) => m.user_profile)
      .map((m) => ({ id: m.user_profile!.id, label: m.user_profile!.full_name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
