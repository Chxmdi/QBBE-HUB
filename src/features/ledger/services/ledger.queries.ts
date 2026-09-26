import type { LedgerAccess } from "@/features/ledger/services/ledger.access";
import type { Choice } from "@/features/ledger/components/entry-form";

export interface EntryChoices {
  accounts: Choice[];
  funds: Choice[];
  programs: Choice[];
  projects: (Choice & { programId: string | null })[];
  defaultFundId: string;
}

/** What a journal line can point at. Inactive accounts and funds are left out. */
export async function loadEntryChoices(
  supabase: LedgerAccess["supabase"],
  organizationId: string,
): Promise<EntryChoices> {
  const [{ data: accounts }, { data: funds }, { data: programs }, { data: projects }] = await Promise.all([
    supabase
      .from("ledger_account")
      .select("id, code, name")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("code"),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).order("name"),
    supabase
      .from("project")
      .select("id, name, program_id")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("name"),
  ]);
  const fundRows = (funds ?? []) as { id: string; code: string; name: string; restriction: string }[];
  return {
    accounts: ((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => ({
      id: a.id,
      label: `${a.code} ${a.name}`,
    })),
    funds: fundRows.map((f) => ({ id: f.id, label: `${f.code} ${f.name}` })),
    programs: ((programs ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
    projects: ((projects ?? []) as { id: string; name: string; program_id: string | null }[]).map((p) => ({
      id: p.id,
      label: p.name,
      programId: p.program_id,
    })),
    defaultFundId:
      fundRows.find((f) => f.code === "GEN")?.id ??
      fundRows.find((f) => f.restriction === "unrestricted")?.id ??
      fundRows[0]?.id ??
      "",
  };
}
