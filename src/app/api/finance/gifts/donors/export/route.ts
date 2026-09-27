import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { centsToDecimal, csvField } from "@/features/finance/money";

/**
 * The donor list as CSV (#156). Read through public.gift_donor_list, which
 * refuses anyone who may not read the ledger and writes an audit record of
 * every export (who, when, which dates) before returning a row. Text is
 * neutralised against spreadsheet formula injection. Column headers and the
 * donor type follow the requester's language; amounts and dates stay
 * machine-readable (1234.56, 2026-09-20) in both.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface DonorRow {
  donor_kind: string;
  donor_name: string;
  donor_email: string | null;
  gift_count: number;
  total_cents: number;
  in_kind_count: number;
  first_gift_on: string;
  last_gift_on: string;
}

export async function GET(request: Request) {
  const session = await requireStaff();
  const t = await getT();
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || from > to) {
    return new Response(t("finance.gifts.api.invalidRange"), { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("gift_donor_list", {
    p_organization: session.organizationId,
    p_from: from,
    p_to: to,
    p_purpose: "export",
  });
  if (error) {
    return new Response(
      error.code === "42501" ? t("finance.gifts.api.noAccess") : t("finance.gifts.api.exportFailed"),
      { status: error.code === "42501" ? 403 : 500 },
    );
  }
  const header = [
    t("finance.gifts.api.csv.donor"),
    t("finance.gifts.api.csv.type"),
    t("finance.gifts.api.csv.email"),
    t("finance.gifts.api.csv.gifts"),
    t("finance.gifts.api.csv.totalMoney"),
    t("finance.gifts.api.csv.inKind"),
    t("finance.gifts.api.csv.firstGift"),
    t("finance.gifts.api.csv.lastGift"),
  ];
  const lines = [header.map(csvField).join(",")];
  for (const r of (data ?? []) as DonorRow[]) {
    lines.push(
      [
        r.donor_name,
        t(r.donor_kind === "contact" ? "finance.gifts.api.csv.person" : "finance.gifts.api.csv.organization"),
        r.donor_email ?? "",
        Number(r.gift_count),
        centsToDecimal(Number(r.total_cents)),
        Number(r.in_kind_count),
        r.first_gift_on,
        r.last_gift_on,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return new Response(`${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="donors-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
