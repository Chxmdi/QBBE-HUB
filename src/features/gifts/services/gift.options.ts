import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordGiftOptions } from "@/features/gifts/components/record-gift-dialog";
import type { GrantOptions } from "@/features/gifts/components/grant-forms";

/** Choices for the gift and grant forms, read with the admin's own client. */

const LIMIT = 1000;

export async function recordGiftOptions(
  supabase: SupabaseClient,
  organizationId: string,
  today: string,
): Promise<RecordGiftOptions> {
  const [contacts, orgs, funds, programs, grants, accounts] = await Promise.all([
    supabase.from("crm_contact").select("id, full_name").eq("organization_id", organizationId).order("full_name").limit(LIMIT),
    supabase.from("crm_organization").select("id, name").eq("organization_id", organizationId).order("name").limit(LIMIT),
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("code"),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).eq("status", "active").order("name"),
    supabase
      .from("grant_award")
      .select("id, title, funder_crm_organization_id, fund_id, funder:funder_crm_organization_id(name)")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("title"),
    supabase
      .from("ledger_account")
      .select("id, code, name, account_type")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("code"),
  ]);
  type Account = { id: string; code: string; name: string; account_type: string };
  const accountList = (accounts.data ?? []) as Account[];
  const asOption = (a: Account) => ({ id: a.id, code: a.code, label: `${a.code} · ${a.name}` });
  // The general fund first: it is the right choice for most gifts.
  const fundList = ((funds.data ?? []) as { id: string; code: string; name: string; restriction: string }[]).sort(
    (a, b) => Number(b.code === "GEN") - Number(a.code === "GEN"),
  );
  return {
    contacts: ((contacts.data ?? []) as { id: string; full_name: string }[]).map((c) => ({ id: c.id, label: c.full_name })),
    organizations: ((orgs.data ?? []) as { id: string; name: string }[]).map((o) => ({ id: o.id, label: o.name })),
    funds: fundList.map((f) => ({
      id: f.id,
      label: `${f.code} · ${f.name}${f.restriction === "unrestricted" ? "" : " (restricted)"}`,
    })),
    programs: ((programs.data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
    grants: (
      (grants.data ?? []) as unknown as {
        id: string;
        title: string;
        funder_crm_organization_id: string;
        fund_id: string;
        funder: { name: string } | null;
      }[]
    ).map((g) => ({
      id: g.id,
      label: `${g.title}${g.funder ? ` (${g.funder.name})` : ""}`,
      funderId: g.funder_crm_organization_id,
      fundId: g.fund_id,
    })),
    debitAccounts: accountList.filter((a) => a.account_type === "asset" || a.account_type === "expense").map(asOption),
    creditAccounts: accountList.filter((a) => a.account_type === "revenue" || a.account_type === "liability").map(asOption),
    today,
  };
}

export async function grantOptions(supabase: SupabaseClient, organizationId: string): Promise<GrantOptions> {
  const [orgs, contacts, funds, programs, members] = await Promise.all([
    supabase.from("crm_organization").select("id, name").eq("organization_id", organizationId).order("name").limit(LIMIT),
    supabase.from("crm_contact").select("id, full_name").eq("organization_id", organizationId).order("full_name").limit(LIMIT),
    supabase.from("ledger_fund").select("id, code, name").eq("organization_id", organizationId).eq("is_active", true).order("code"),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).eq("status", "active").order("name"),
    supabase
      .from("organization_membership")
      .select("user_id, user_profile:user_id(full_name, email)")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", ["owner", "admin", "staff"]),
  ]);
  return {
    funders: ((orgs.data ?? []) as { id: string; name: string }[]).map((o) => ({ id: o.id, label: o.name })),
    contacts: ((contacts.data ?? []) as { id: string; full_name: string }[]).map((c) => ({ id: c.id, label: c.full_name })),
    funds: ((funds.data ?? []) as { id: string; code: string; name: string }[]).map((f) => ({
      id: f.id,
      label: `${f.code} · ${f.name}`,
    })),
    programs: ((programs.data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
    staff: (
      (members.data ?? []) as unknown as { user_id: string; user_profile: { full_name: string; email: string } | null }[]
    )
      .map((m) => ({ id: m.user_id, label: m.user_profile?.full_name || m.user_profile?.email || "Staff member" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
