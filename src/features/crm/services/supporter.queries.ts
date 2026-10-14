import { createSupabasePageClient } from "@/lib/supabase/page";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reads behind the supporter screens. Contacts come straight from
 * crm_contact under row-level security (staff). Anything with an amount comes
 * from the Zeffy database functions, which return amounts to finance readers
 * only and record each time they do; for everyone else the totals call is
 * refused (42501) and the screens simply have no amounts to show.
 */

export const SUPPORTERS_PAGE_SIZE = 50;

export interface SupporterRow {
  id: string;
  full_name: string;
  email: string | null;
  source: string;
  zeffy_kinds: string[];
  zeffy_last_activity_at: string | null;
  crm_organization: { id: string; name: string } | null;
}

export interface SupporterTotals {
  contact_id: string;
  currency: string | null;
  net_cents: number;
  this_year_cents: number;
  payment_count: number;
  first_paid_at: string | null;
  last_paid_at: string | null;
  last_amount_cents: number | null;
  recurring_active: boolean;
}

export interface SupporterFilters {
  q?: string;
  kind?: string;
  source?: string;
  page?: number;
}

/** PostgREST `ilike` treats % and _ as wildcards and , ( ) as syntax. */
function likeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`).replace(/[,()]/g, " ");
}

export async function listSupporters(filters: SupporterFilters) {
  const supabase = await createSupabasePageClient();
  const page = Math.max(1, filters.page ?? 1);
  let query = supabase
    .from("crm_contact")
    .select(
      "id, full_name, email, source, zeffy_kinds, zeffy_last_activity_at, crm_organization:crm_organization_id(id, name)",
    )
    .neq("status", "inactive");
  const q = filters.q?.trim().slice(0, 100);
  if (q) {
    const term = likeTerm(q);
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  if (filters.kind) query = query.contains("zeffy_kinds", [filters.kind]);
  if (filters.source === "hub" || filters.source === "zeffy") query = query.eq("source", filters.source);
  const { data, error } = await query
    .order("zeffy_last_activity_at", { ascending: false, nullsFirst: false })
    .order("full_name")
    .range((page - 1) * SUPPORTERS_PAGE_SIZE, page * SUPPORTERS_PAGE_SIZE);
  if (error) throw new Error(`Could not load supporters: ${error.message}`);
  const rows = (data ?? []) as unknown as SupporterRow[];
  return {
    rows: rows.slice(0, SUPPORTERS_PAGE_SIZE),
    hasMore: rows.length > SUPPORTERS_PAGE_SIZE,
    page,
  };
}

/**
 * Giving per supporter, or null when the viewer is not a finance reader.
 * Each successful call is audited by the database.
 *
 * Uses the ordinary server client, not the page client: for staff the
 * refusal (42501) is the expected answer and means "show no amounts", while
 * the page client would turn it into the error page. Any other error still
 * throws.
 */
export async function getSupporterTotals(
  organizationId: string,
  contactId: string | null = null,
): Promise<Map<string, SupporterTotals> | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("zeffy_supporter_totals", {
    p_organization: organizationId,
    p_purpose: "view",
    p_contact: contactId,
  });
  if (error) {
    if (error.code === "42501") return null;
    throw new Error(`Could not load supporter totals: ${error.message}`);
  }
  const map = new Map<string, SupporterTotals>();
  for (const row of (data ?? []) as SupporterTotals[]) {
    map.set(row.contact_id, {
      ...row,
      net_cents: Number(row.net_cents),
      this_year_cents: Number(row.this_year_cents),
      payment_count: Number(row.payment_count),
      last_amount_cents: row.last_amount_cents === null ? null : Number(row.last_amount_cents),
    });
  }
  return map;
}

export interface SupporterActivity {
  zeffy_id: string;
  paid_at: string;
  campaign_title: string | null;
  campaign_category: string | null;
  item_kinds: string[];
  status: string;
  refund_status: string;
  dispute_status: string | null;
  is_recurring: boolean;
  recurring_interval: string | null;
  currency: string;
  amount_cents: number | null;
  refunded_cents: number | null;
  receipt_url: string | null;
}

export async function getSupporter(contactId: string) {
  const supabase = await createSupabasePageClient();
  const { data: contact, error } = await supabase
    .from("crm_contact")
    .select(
      "id, organization_id, full_name, email, phone, role_title, source, status, zeffy_contact_id, zeffy_kinds, zeffy_last_activity_at, crm_organization:crm_organization_id(id, name)",
    )
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the supporter: ${error.message}`);
  if (!contact) return null;

  const [activity, interactions, organizations] = await Promise.all([
    supabase.rpc("zeffy_supporter_activity", { p_contact: contactId }),
    supabase
      .from("crm_interaction")
      .select("id, interaction_type, occurred_at, summary, owner:owner_id(full_name)")
      .eq("contact_id", contactId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase.from("crm_organization").select("id, name").order("name").limit(500),
  ]);
  if (activity.error) throw new Error(`Could not load Zeffy activity: ${activity.error.message}`);

  return {
    contact: contact as unknown as {
      id: string;
      organization_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      role_title: string | null;
      source: string;
      status: string;
      zeffy_contact_id: string | null;
      zeffy_kinds: string[];
      zeffy_last_activity_at: string | null;
      crm_organization: { id: string; name: string } | null;
    },
    activity: ((activity.data ?? []) as SupporterActivity[]).map((row) => ({
      ...row,
      amount_cents: row.amount_cents === null ? null : Number(row.amount_cents),
      refunded_cents: row.refunded_cents === null ? null : Number(row.refunded_cents),
    })),
    interactions: (interactions.data ?? []) as unknown as {
      id: string;
      interaction_type: string;
      occurred_at: string;
      summary: string;
      owner: { full_name: string } | null;
    }[],
    organizations: (organizations.data ?? []) as { id: string; name: string }[],
  };
}

export interface ZeffyOverview {
  supporters: number;
  new_supporters: number;
  payments: number;
  needs_matching: number;
  attendance: { campaign_id: string | null; title: string | null; tickets: number; buyers: number }[];
  connection: { status: string; last_sync_at: string | null } | null;
  money: {
    currency: string;
    raised_cents: number;
    raised_year_cents: number;
    by_category: { category: string; cents: number }[];
    recurring_donors: number;
    monthly_recurring_cents: number;
    lapsed_donors: number;
    refunded_cents: number;
    disputes_open: number;
  } | null;
}

export async function getZeffyOverview(organizationId: string, from: string, to: string) {
  const supabase = await createSupabasePageClient();
  const [overview, campaigns, matches] = await Promise.all([
    supabase.rpc("zeffy_overview", { p_organization: organizationId, p_from: from, p_to: to }),
    supabase
      .from("zeffy_campaign")
      .select("zeffy_id, title, category, status, url, goal_cents, raised_cents, currency, ends_at, is_archived")
      .is("deleted_at", null)
      .eq("is_archived", false)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("zeffy_contact_match")
      .select("id, full_name, email, candidate_ids, created_at")
      .is("resolved_at", null)
      .order("created_at")
      .limit(50),
  ]);
  if (overview.error) throw new Error(`Could not load the Zeffy overview: ${overview.error.message}`);

  const matchRows = (matches.data ?? []) as {
    id: string;
    full_name: string;
    email: string | null;
    candidate_ids: string[];
  }[];
  const candidateIds = [...new Set(matchRows.flatMap((row) => row.candidate_ids))];
  const { data: candidates } = candidateIds.length
    ? await supabase
        .from("crm_contact")
        .select("id, full_name, email, crm_organization:crm_organization_id(name)")
        .in("id", candidateIds)
    : { data: [] };
  const candidateById = new Map(
    ((candidates ?? []) as unknown as {
      id: string;
      full_name: string;
      email: string | null;
      crm_organization: { name: string } | null;
    }[]).map((row) => [row.id, row]),
  );

  return {
    overview: overview.data as ZeffyOverview,
    campaigns: (campaigns.data ?? []) as {
      zeffy_id: string;
      title: string;
      category: string | null;
      status: string | null;
      url: string | null;
      goal_cents: number | null;
      raised_cents: number | null;
      currency: string | null;
      ends_at: string | null;
    }[],
    matches: matchRows.map((row) => ({
      ...row,
      candidates: row.candidate_ids
        .map((id) => candidateById.get(id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate)),
    })),
  };
}
