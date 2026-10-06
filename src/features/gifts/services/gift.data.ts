import type { SupabaseClient } from "@supabase/supabase-js";
import type { AckGift, GiftType } from "@/features/gifts/acknowledgement";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Reads shared by the gift pages and actions (#156). They go through the
 * caller's own client, so row-level security decides what comes back: admins
 * with MFA and named ledger readers see gifts, nobody else does.
 */

export const GIFT_SELECT = `id, gift_number, gift_type, received_on, amount_cents, in_kind_description,
  value_supplied_by_donor, donor_restriction, note, status, void_reason, voided_at, created_at,
  journal_entry_id, void_entry_id, grant_id, crm_contact_id, crm_organization_id,
  contact:crm_contact_id(id, full_name, email),
  crm_org:crm_organization_id(id, name),
  fund:ledger_fund!gift_organization_id_fund_id_fkey(id, code, name, restriction),
  program:program_id(id, name),
  grant:grant_award!gift_organization_id_grant_id_fkey(id, title),
  entry:journal_entry!gift_organization_id_journal_entry_id_fkey(id, entry_number),
  void_entry:journal_entry!gift_organization_id_void_entry_id_fkey(id, entry_number)`;

export interface GiftRow {
  id: string;
  gift_number: number;
  gift_type: GiftType;
  received_on: string;
  amount_cents: number | null;
  in_kind_description: string | null;
  value_supplied_by_donor: boolean;
  donor_restriction: string | null;
  note: string | null;
  status: "recorded" | "voided";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  journal_entry_id: string | null;
  void_entry_id: string | null;
  grant_id: string | null;
  crm_contact_id: string | null;
  crm_organization_id: string | null;
  contact: { id: string; full_name: string; email: string | null } | null;
  crm_org: { id: string; name: string } | null;
  fund: { id: string; code: string; name: string; restriction: AckGift["fundRestriction"] } | null;
  program: { id: string; name: string } | null;
  grant: { id: string; title: string } | null;
  entry: { id: string; entry_number: number | null } | null;
  void_entry: { id: string; entry_number: number | null } | null;
}

/** `unknown` is shown when neither CRM record came back; pages pass it translated. */
export function donorName(row: Pick<GiftRow, "contact" | "crm_org">, unknown: string = "Unknown donor"): string {
  return row.contact?.full_name ?? row.crm_org?.name ?? unknown;
}

export function toAckGift(row: GiftRow): AckGift {
  return {
    number: row.gift_number,
    type: row.gift_type,
    receivedOn: row.received_on,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    inKindDescription: row.in_kind_description,
    valueSuppliedByDonor: row.value_supplied_by_donor,
    fundName: row.fund?.name ?? "",
    fundRestriction: row.fund?.restriction ?? "unrestricted",
    programName: row.program?.name ?? null,
    donorRestriction: row.donor_restriction,
    grantTitle: row.grant?.title ?? null,
  };
}

export async function loadGift(supabase: SupabaseClient, organizationId: string, id: string) {
  const { data } = await supabase
    .from("gift")
    .select(GIFT_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as GiftRow | null) ?? null;
}

export async function organizationName(supabase: SupabaseClient, organizationId: string): Promise<string> {
  const { data } = await supabase.from("organization").select("name").eq("id", organizationId).maybeSingle();
  return (data?.name as string | undefined) ?? "QBBE";
}

/** "contact:<uuid>" or "organization:<uuid>": a CRM donor, as used in URLs and forms. */
export type DonorKey = { kind: "contact" | "organization"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDonorKey(value: unknown): DonorKey | null {
  if (typeof value !== "string") return null;
  const [kind, id] = value.split(":");
  if ((kind !== "contact" && kind !== "organization") || !id || !UUID.test(id)) return null;
  return { kind, id };
}

export function donorKey(row: { crm_contact_id: string | null; crm_organization_id: string | null }): string {
  return row.crm_contact_id ? `contact:${row.crm_contact_id}` : `organization:${row.crm_organization_id}`;
}

export const GIFT_TYPE_KEY: Record<GiftType, MessageKey> = {
  donation: "finance.gifts.types.donation",
  grant_payment: "finance.gifts.types.grant_payment",
  in_kind: "finance.gifts.types.in_kind",
};

/** A row of public.gift_donor_statement. */
export interface StatementRow {
  gift_id: string;
  gift_number: number;
  gift_type: GiftType;
  received_on: string;
  amount_cents: number | null;
  in_kind_description: string | null;
  value_supplied_by_donor: boolean;
  fund_name: string;
  fund_restriction: AckGift["fundRestriction"];
  program_name: string | null;
}

export function statementGifts(rows: StatementRow[]): AckGift[] {
  return rows.map((r) => ({
    number: r.gift_number,
    type: r.gift_type,
    receivedOn: r.received_on,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    inKindDescription: r.in_kind_description,
    valueSuppliedByDonor: r.value_supplied_by_donor,
    fundName: r.fund_name,
    fundRestriction: r.fund_restriction,
    programName: r.program_name,
    donorRestriction: null,
    grantTitle: null,
  }));
}
