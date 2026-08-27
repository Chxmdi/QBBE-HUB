import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OpportunityKind, OpportunityStage } from "@/features/crm/opportunity-schemas";
import { isOpenStage } from "@/features/crm/opportunity-schemas";

/**
 * Reads for the funding pipeline.
 *
 * Everything here runs as the signed-in person, so the CRM policy decides what
 * comes back. A volunteer calling these gets an empty pipeline rather than an
 * error, which is the correct answer to "what funding can you see".
 */

export interface OpportunityRow {
  id: string;
  title: string;
  description: string | null;
  kind: OpportunityKind;
  stage: OpportunityStage;
  currency: string;
  amount_requested: string | null;
  amount_awarded: string | null;
  submitted_at: string | null;
  decision_expected_at: string | null;
  decided_at: string | null;
  outcome_note: string | null;
  is_open: boolean;
  crm_organization: { id: string; name: string } | null;
  contact: { id: string; full_name: string } | null;
  owner: { id: string; full_name: string } | null;
  program: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}

const SELECT =
  "id, title, description, kind, stage, currency, amount_requested, amount_awarded, " +
  "submitted_at, decision_expected_at, decided_at, outcome_note, is_open, " +
  "crm_organization:crm_organization_id(id, name), contact:contact_id(id, full_name), " +
  "owner:owner_id(id, full_name), program:program_id(id, name), project:project_id(id, name)";

export interface Pipeline {
  open: OpportunityRow[];
  settled: OpportunityRow[];
  /**
   * Totals by currency, because summing across currencies produces a number
   * that is wrong in every currency. A pipeline in one currency — the usual
   * case — still reads as a single figure.
   */
  requestedByCurrency: { currency: string; total: number; count: number }[];
  awardedByCurrency: { currency: string; total: number; count: number }[];
  overdueDecisions: number;
}

function totalsByCurrency(
  rows: OpportunityRow[],
  field: "amount_requested" | "amount_awarded",
): { currency: string; total: number; count: number }[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const raw = row[field];
    if (raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const entry = totals.get(row.currency) ?? { total: 0, count: 0 };
    entry.total += value;
    entry.count += 1;
    totals.set(row.currency, entry);
  }
  return Array.from(totals.entries())
    .map(([currency, entry]) => ({ currency, ...entry }))
    .sort((a, b) => b.total - a.total);
}

export function summarizePipeline(rows: OpportunityRow[], today: string): Pipeline {
  const open = rows.filter((row) => isOpenStage(row.stage));
  const settled = rows.filter((row) => !isOpenStage(row.stage));

  return {
    open,
    settled,
    requestedByCurrency: totalsByCurrency(open, "amount_requested"),
    awardedByCurrency: totalsByCurrency(
      settled.filter((row) => row.stage === "awarded"),
      "amount_awarded",
    ),
    overdueDecisions: open.filter(
      (row) => row.decision_expected_at !== null && row.decision_expected_at < today,
    ).length,
  };
}

/** Every opportunity with one funder, for the relationship page. */
export async function getOpportunitiesForCrmOrganization(
  crmOrganizationId: string,
  today: string,
): Promise<Pipeline> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("opportunity")
    .select(SELECT)
    .eq("crm_organization_id", crmOrganizationId)
    // Soonest decision first among live bids; the settled half is split out
    // below, so a null decision date sorting last is what we want.
    .order("decision_expected_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  return summarizePipeline((data ?? []) as unknown as OpportunityRow[], today);
}

/** The whole organization's pipeline, for the CRM index. */
export async function getPipeline(today: string): Promise<Pipeline> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("opportunity")
    .select(SELECT)
    .order("decision_expected_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);

  return summarizePipeline((data ?? []) as unknown as OpportunityRow[], today);
}
