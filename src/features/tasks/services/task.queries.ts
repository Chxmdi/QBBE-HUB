import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import {
  applyTaskFilters,
  taskSelectFor,
  type TaskFilters,
} from "@/features/tasks/filters";
import type { Meeting, Task } from "@/types/entities";

export const TASK_SELECT =
  "id, program_id, project_id, milestone_id, title, description, status, priority, " +
  "assignee_id, reviewer_id, start_at, due_at, blocked_reason, sort_key, completed_at, " +
  "created_at, archived_at, " +
  "assignee:assignee_id(id, full_name, email, avatar_url, title, timezone), " +
  "project:project_id(id, name)";

/**
 * A query either produced rows or failed. Returning `[]` for both is why a
 * failed My Work read used to render "Your workload is clear" — the most
 * reassuring possible way to say that nothing could be loaded.
 */
export interface TaskQueryResult {
  tasks: Task[];
  failed: boolean;
}

/**
 * Tasks the viewer can reach, narrowed by the shared filter set (P0-TSK-08).
 * RLS decides what "can reach" means; these filters only narrow it further.
 */
export async function getScopedTasks(
  filters: TaskFilters,
  today: string,
): Promise<TaskQueryResult> {
  const supabase = await createSupabaseServerClient();
  const query = applyTaskFilters(
    supabase
      .from("task")
      .select(taskSelectFor(filters, TASK_SELECT))
      .is("archived_at", null)
      .order("sort_key", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(300),
    filters,
    today,
  );

  const { data, error } = await query;
  return { tasks: (data ?? []) as unknown as Task[], failed: Boolean(error) };
}

/** The buckets My Work is made of (P0-TSK-06). */
export interface MyWork {
  owned: Task[];
  reviewing: Task[];
  blocked: Task[];
  meetings: Meeting[];
  failed: boolean;
}

/**
 * Everything waiting on one person.
 *
 * "Owned" and "reviewing" are separate queries rather than one `or`, because
 * they are separate questions: the review queue is work you are accountable
 * for judging, not for doing, and a single list buries that distinction.
 * Review duty can arrive three ways — the reviewer and approver columns, and
 * an explicit task_assignment role — so all three are asked for.
 */
export async function getMyWork(
  userId: string,
  filters: TaskFilters,
  today: string,
): Promise<MyWork> {
  const supabase = await createSupabaseServerClient();
  const select = taskSelectFor(filters, TASK_SELECT);

  const { data: roleRows } = await supabase
    .from("task_assignment")
    .select("task_id")
    .eq("user_id", userId)
    .in("role", ["reviewer", "approver"]);
  const roleTaskIds = (roleRows ?? []).map((row) => row.task_id as string);

  const ownedQuery = applyTaskFilters(
    supabase
      .from("task")
      .select(select)
      .eq("assignee_id", userId)
      .is("archived_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(300),
    filters,
    today,
  );

  // `or` takes a PostgREST filter string; the ids are uuids straight from the
  // database, and the column names are literals.
  const reviewClauses = [
    `reviewer_id.eq.${userId}`,
    `approver_id.eq.${userId}`,
    ...(roleTaskIds.length ? [`id.in.(${roleTaskIds.join(",")})`] : []),
  ];
  const reviewingQuery = applyTaskFilters(
    supabase
      .from("task")
      .select(select)
      .or(reviewClauses.join(","))
      // "Work I judge, not work I do" — but `neq` is NULL-blind. In SQL
      // `null <> '<uuid>'` is null, not true, so an unassigned task was
      // dropped from the review queue entirely. That is the case a reviewer
      // most needs: nobody has picked the work up yet and it is waiting on a
      // decision. Two `or` parameters are ANDed by PostgREST, so this narrows
      // the review clauses above rather than widening them.
      .or(`assignee_id.is.null,assignee_id.neq.${userId}`)
      .is("archived_at", null)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(300),
    filters,
    today,
  );

  const [owned, reviewing, meetings] = await Promise.all([
    ownedQuery,
    reviewingQuery,
    supabase
      .from("meeting")
      .select(
        "id, program_id, project_id, title, purpose, organizer_id, starts_at, ends_at, " +
          "location, meeting_link, status, notes, channel_id, project:project_id(id, name)",
      )
      .gte("starts_at", new Date().toISOString())
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(5),
  ]);

  const ownedTasks = (owned.data ?? []) as unknown as Task[];

  return {
    owned: ownedTasks,
    reviewing: (reviewing.data ?? []) as unknown as Task[],
    // Blocked work is drawn from what was already loaded rather than asked for
    // again: it is the same records seen a second way, which is the property
    // P0-TSK-07 asks the list and board to preserve.
    blocked: ownedTasks.filter((task) => task.status === "blocked"),
    meetings: (meetings.data ?? []) as unknown as Meeting[],
    failed: Boolean(owned.error || reviewing.error),
  };
}

export interface SelectOption {
  id: string;
  label: string;
}

export interface MilestoneSelectOption extends SelectOption {
  projectId: string;
}

/**
 * Options for pickers and filters. Every list is read through RLS, so each
 * already contains only what the caller may reach — a filter offering the name
 * of a program you cannot see would itself be a disclosure.
 */
export async function getPickerOptions(): Promise<{
  projects: SelectOption[];
  people: SelectOption[];
  programs: SelectOption[];
  milestones: MilestoneSelectOption[];
  labels: SelectOption[];
}> {
  // Empty pickers would read as "nobody to assign"; a failure must say so.
  const supabase = await createSupabasePageClient();
  const [
    { data: projects },
    { data: members },
    { data: programs },
    { data: milestones },
    { data: labels },
  ] = await Promise.all([
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
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
    supabase.from("milestone").select("id, name, project_id").order("sort_key"),
    supabase.from("label").select("id, name").order("name"),
  ]);

  type MemberRow = { user_profile: { id: string; full_name: string } | null };

  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, label: p.name })),
    people: ((members ?? []) as unknown as MemberRow[])
      .filter((m) => m.user_profile)
      .map((m) => ({ id: m.user_profile!.id, label: m.user_profile!.full_name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    programs: (programs ?? []).map((p) => ({ id: p.id, label: p.name })),
    milestones: (milestones ?? []).map((m) => ({
      id: m.id,
      label: m.name,
      projectId: m.project_id as string,
    })),
    labels: (labels ?? []).map((l) => ({ id: l.id, label: l.name })),
  };
}
