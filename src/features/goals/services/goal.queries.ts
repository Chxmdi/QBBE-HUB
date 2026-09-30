import { createSupabasePageClient } from "@/lib/supabase/page";
// Page reads: the page client throws on a failed query, so an outage reaches
// the error page instead of reading as "not found" or an empty list (P0-UX-05).
import { goalProgress, progressPart, type ProgressInput, type ProgressPart } from "../progress";

export type GoalStatus = "active" | "achieved" | "dropped";

export interface GoalSummary {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  targetOn: string | null;
  program: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  progress: number | null;
}

export interface GoalDetail extends GoalSummary {
  parts: ProgressPart[];
  canManage: boolean;
}

type Client = Awaited<ReturnType<typeof createSupabasePageClient>>;
type Named = { id: string; full_name: string | null } | null;

const SELECT = "id, title, description, status, target_on, program:program_id(id, name), owner:owner_id(id, full_name)";

interface Row {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  target_on: string | null;
  program: { id: string; name: string } | null;
  owner: Named;
}

async function partsFor(supabase: Client, goalId: string): Promise<ProgressPart[]> {
  const { data } = await supabase.rpc("goal_progress_inputs", { p_goal: goalId });
  return ((data ?? []) as ProgressInput[]).map(progressPart);
}

function summary(row: Row, parts: ProgressPart[]): GoalSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    targetOn: row.target_on,
    program: row.program,
    owner: row.owner ? { id: row.owner.id, name: row.owner.full_name ?? "" } : null,
    progress: goalProgress(parts),
  };
}

/** Every goal the viewer can read, with live progress. */
export async function listGoals(): Promise<GoalSummary[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("goal")
    .select(SELECT)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const parts = await Promise.all(rows.map((row) => partsFor(supabase, row.id)));
  return rows.map((row, i) => summary(row, parts[i]));
}

export async function getGoal(goalId: string): Promise<GoalDetail | null> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase.from("goal").select(SELECT).eq("id", goalId).maybeSingle();
  if (!data) return null;
  const [parts, { data: canManage }] = await Promise.all([
    partsFor(supabase, goalId),
    supabase.rpc("can_manage_goal", { p_goal: goalId }),
  ]);
  return { ...summary(data as unknown as Row, parts), parts, canManage: canManage === true };
}

/** What the forms can offer: programs, people, readable projects and live metrics. */
export async function getGoalOptions(): Promise<{
  programs: { id: string; name: string }[];
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  metrics: { id: string; name: string }[];
}> {
  const supabase = await createSupabasePageClient();
  const [programs, members, projects, metrics] = await Promise.all([
    supabase.from("program").select("id, name").order("name"),
    supabase.from("organization_membership").select("user_profile:user_id(id, full_name)").eq("status", "active"),
    supabase.from("project").select("id, name").is("archived_at", null).order("name").limit(500),
    supabase.from("outcome_metric").select("id, name").is("retired_at", null).order("name").limit(500),
  ]);
  return {
    programs: (programs.data ?? []) as { id: string; name: string }[],
    people: ((members.data ?? []) as unknown as { user_profile: Named }[])
      .map((m) => m.user_profile)
      .filter((u): u is { id: string; full_name: string | null } => u !== null)
      .map((u) => ({ id: u.id, name: u.full_name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects: (projects.data ?? []) as { id: string; name: string }[],
    metrics: (metrics.data ?? []) as { id: string; name: string }[],
  };
}
