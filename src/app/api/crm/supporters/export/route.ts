import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { centsToDecimal, csvField } from "@/features/finance/money";
import { zeffyKindLabel } from "@/features/crm/labels";

/**
 * Supporters' Zeffy giving as CSV. Read through public.zeffy_supporter_totals,
 * which refuses anyone who may not read the ledger and records every export
 * (who and when) before returning a row. Names, emails and activity come from
 * the CRM contacts the requester can already see. Text is neutralised against
 * spreadsheet formula injection; amounts and dates stay machine-readable
 * (1234.56, 2026-09-20) in both languages.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TotalsRow {
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

interface ContactRow {
  id: string;
  full_name: string;
  email: string | null;
  zeffy_kinds: string[];
  crm_organization: { name: string } | null;
}

/** Keeps each `in (...)` list well inside a URL's length. */
const CONTACT_CHUNK = 200;

export async function GET() {
  const session = await requireStaff();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("zeffy_supporter_totals", {
    p_organization: session.organizationId,
    p_purpose: "export",
    p_contact: null,
  });
  if (error) {
    return new Response(
      error.code === "42501" ? t("crm.supporters.noAccess") : t("crm.supporters.exportFailed"),
      { status: error.code === "42501" ? 403 : 500 },
    );
  }
  const totals = (data ?? []) as TotalsRow[];
  const contacts = new Map<string, ContactRow>();
  for (let start = 0; start < totals.length; start += CONTACT_CHUNK) {
    const ids = totals.slice(start, start + CONTACT_CHUNK).map((row) => row.contact_id);
    const { data: rows, error: contactError } = await supabase
      .from("crm_contact")
      .select("id, full_name, email, zeffy_kinds, crm_organization:crm_organization_id(name)")
      .in("id", ids);
    if (contactError) return new Response(t("crm.supporters.exportFailed"), { status: 500 });
    for (const row of (rows ?? []) as unknown as ContactRow[]) contacts.set(row.id, row);
  }

  const header = [
    t("crm.supporters.csv.name"),
    t("crm.supporters.csv.email"),
    t("crm.supporters.csv.activity"),
    t("crm.supporters.csv.organization"),
    t("crm.supporters.csv.currency"),
    t("crm.supporters.csv.net"),
    t("crm.supporters.csv.thisYear"),
    t("crm.supporters.csv.payments"),
    t("crm.supporters.csv.firstPayment"),
    t("crm.supporters.csv.lastPayment"),
    t("crm.supporters.csv.lastAmount"),
    t("crm.supporters.csv.recurring"),
  ];
  const lines = [header.map(csvField).join(",")];
  for (const row of totals) {
    const contact = contacts.get(row.contact_id);
    if (!contact) continue;
    lines.push(
      [
        contact.full_name,
        contact.email ?? "",
        contact.zeffy_kinds.map((code) => zeffyKindLabel(code, t)).join("; "),
        contact.crm_organization?.name ?? "",
        (row.currency ?? "cad").toUpperCase(),
        centsToDecimal(Number(row.net_cents)),
        centsToDecimal(Number(row.this_year_cents)),
        Number(row.payment_count),
        row.first_paid_at?.slice(0, 10) ?? "",
        row.last_paid_at?.slice(0, 10) ?? "",
        row.last_amount_cents === null ? "" : centsToDecimal(Number(row.last_amount_cents)),
        t(row.recurring_active ? "crm.supporters.csv.yes" : "crm.supporters.csv.no"),
      ]
        .map(csvField)
        .join(","),
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="supporters-giving-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
