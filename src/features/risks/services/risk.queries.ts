import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  SETTLED_ISSUE_STATUSES,
  SETTLED_RISK_STATUSES,
  riskNeedsReview,
  type IssueSeverity,
  type IssueStatus,
  type RiskImpact,
  type RiskLikelihood,
  type RiskStatus,
} from "@/features/risks/schemas";

/**
 * The project's risk and issue log, read as the signed-in person so RLS
 * decides. Open items come first and settled ones stay visible but out of the
 * way — a closed risk is the record of a decision, not clutter to be deleted.
 */

export interface RiskRow {
  id: string;
  title: string;
  description: string | null;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  status: RiskStatus;
  score: number;
  mitigation: string | null;
  review_at: string | null;
  owner: { id: string; full_name: string } | null;
}

export interface IssueRow {
  id: string;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  resolution: string | null;
  due_at: string | null;
  risk_id: string | null;
  owner: { id: string; full_name: string } | null;
}

export interface RaidLog {
  openRisks: RiskRow[];
  settledRisks: RiskRow[];
  openIssues: IssueRow[];
  settledIssues: IssueRow[];
  /** Open items whose review date has arrived — the reason to open this tab. */
  needingReview: number;
  openCount: number;
}

export async function getRaidLog(projectId: string): Promise<RaidLog> {
  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);

  const [risks, issues] = await Promise.all([
    supabase
      .from("risk")
      .select(
        "id, title, description, likelihood, impact, status, score, mitigation, review_at, owner:owner_id(id, full_name)",
      )
      .eq("project_id", projectId)
      .order("score", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("issue")
      .select(
        "id, title, description, severity, status, resolution, due_at, risk_id, owner:owner_id(id, full_name)",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  const riskRows = (risks.data ?? []) as unknown as RiskRow[];
  const issueRows = (issues.data ?? []) as unknown as IssueRow[];

  const openRisks = riskRows.filter((r) => !SETTLED_RISK_STATUSES.includes(r.status));
  const settledRisks = riskRows.filter((r) => SETTLED_RISK_STATUSES.includes(r.status));
  const openIssues = issueRows.filter((i) => !SETTLED_ISSUE_STATUSES.includes(i.status));
  const settledIssues = issueRows.filter((i) => SETTLED_ISSUE_STATUSES.includes(i.status));

  return {
    openRisks,
    settledRisks,
    openIssues,
    settledIssues,
    needingReview: openRisks.filter((r) => riskNeedsReview(r, today)).length,
    openCount: openRisks.length + openIssues.length,
  };
}
