import { createSupabasePageClient } from "@/lib/supabase/page";
// Page reads: the page client throws on a failed query, so an outage reaches
// the error page instead of reading as "not found" or an empty list (P0-UX-05).

export interface DecisionRecord {
  id: string;
  title: string;
  problem: string | null;
  options: string[];
  evidence: string | null;
  reasoning: string | null;
  /** Earlier fields, shown when the new ones are empty. */
  legacyRationale: string | null;
  legacyAlternatives: string | null;
  decidedAt: string;
  decidedBy: string | null;
  revisitOn: string | null;
  reopenedAt: string | null;
  project: { id: string; name: string } | null;
  meeting: { id: string; title: string } | null;
  participants: { id: string; name: string }[];
}

type Named = { id: string; full_name: string | null } | null;

const SELECT =
  "id, title, detail, alternatives, problem, options_considered, evidence, reasoning, decided_at, revisit_on, reopened_at, " +
  "decider:decided_by(id, full_name), project:project_id(id, name), meeting:meeting_id(id, title), " +
  "participants:decision_participant(user:user_id(id, full_name))";

interface Row {
  id: string;
  title: string;
  detail: string | null;
  alternatives: string | null;
  problem: string | null;
  options_considered: unknown;
  evidence: string | null;
  reasoning: string | null;
  decided_at: string;
  revisit_on: string | null;
  reopened_at: string | null;
  decider: Named;
  project: { id: string; name: string } | null;
  meeting: { id: string; title: string } | null;
  participants: { user: Named }[] | null;
}

function toRecord(row: Row): DecisionRecord {
  return {
    id: row.id,
    title: row.title,
    problem: row.problem,
    options: Array.isArray(row.options_considered)
      ? row.options_considered.filter((o): o is string => typeof o === "string")
      : [],
    evidence: row.evidence,
    reasoning: row.reasoning,
    legacyRationale: row.detail,
    legacyAlternatives: row.alternatives,
    decidedAt: row.decided_at,
    decidedBy: row.decider?.full_name ?? null,
    revisitOn: row.revisit_on,
    reopenedAt: row.reopened_at,
    project: row.project,
    meeting: row.meeting,
    participants: (row.participants ?? [])
      .map((p) => p.user)
      .filter((u): u is { id: string; full_name: string | null } => u !== null)
      .map((u) => ({ id: u.id, name: u.full_name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** One decision, or null when RLS hides it. */
export async function getDecision(decisionId: string): Promise<{
  decision: DecisionRecord;
  canManage: boolean;
  people: { id: string; name: string }[];
} | null> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase.from("decision").select(SELECT).eq("id", decisionId).maybeSingle();
  if (!data) return null;
  const [{ data: canManage }, { data: members }] = await Promise.all([
    supabase.rpc("can_manage_decision", { p_decision: decisionId }),
    supabase.from("organization_membership").select("user_profile:user_id(id, full_name)").eq("status", "active"),
  ]);
  const people = ((members ?? []) as unknown as { user_profile: Named }[])
    .map((m) => m.user_profile)
    .filter((u): u is { id: string; full_name: string | null } => u !== null)
    .map((u) => ({ id: u.id, name: u.full_name ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { decision: toRecord(data as unknown as Row), canManage: canManage === true, people };
}

/** Every decision the viewer can read on a project, newest first. */
export async function getDecisionTrail(projectId: string): Promise<{
  project: { id: string; name: string };
  decisions: DecisionRecord[];
} | null> {
  const supabase = await createSupabasePageClient();
  const { data: project } = await supabase.from("project").select("id, name").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const { data } = await supabase
    .from("decision")
    .select(SELECT)
    .eq("project_id", projectId)
    .order("decided_at", { ascending: false })
    .limit(200);
  return {
    project: { id: project.id as string, name: project.name as string },
    decisions: ((data ?? []) as unknown as Row[]).map(toRecord),
  };
}
