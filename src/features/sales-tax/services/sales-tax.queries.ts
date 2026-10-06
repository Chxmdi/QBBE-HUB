import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { centsToDecimal, csvDocument } from "@/features/ledger/money";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";
import {
  TAX_CODE_LABEL,
  closingFigures,
  gstReturnLines,
  psbRebate,
  qstReturnLines,
  type Direction,
  type FilingFrequency,
  type ReturnLine,
  type TaxCode,
  type TaxTotalsRow,
} from "@/features/sales-tax/return-lines";

/**
 * Reads for the GST/QST screens (#152). Row-level security decides what is
 * returned: ledger readers and admins with MFA see their organization's tax
 * records, everyone else sees nothing.
 */

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TaxSettings {
  gst_registered: boolean;
  gst_number: string | null;
  qst_registered: boolean;
  qst_number: string | null;
  filing_frequency: FilingFrequency;
  itc_claim_bp: number;
  show_psb_rebate: boolean;
  updated_at: string;
}

export interface TaxPeriod {
  id: string;
  starts_on: string;
  ends_on: string;
  status: "open" | "closed";
  gst_collected_cents: number | null;
  gst_claimed_cents: number | null;
  qst_collected_cents: number | null;
  qst_claimed_cents: number | null;
  closing_entry_id: string | null;
  closed_at: string | null;
}

export interface TaxLine {
  id: string;
  direction: Direction;
  tax_code: TaxCode;
  transaction_date: string;
  counterparty: string;
  reference: string | null;
  description: string | null;
  amount_cents: number;
  gst_cents: number;
  qst_cents: number;
  itc_cents: number;
  itr_cents: number;
  source_type: string | null;
  source_id: string | null;
}

export const LINE_LIMIT = 1000;

export async function getTaxSettings(supabase: Client, organizationId: string): Promise<TaxSettings | null> {
  const { data } = await supabase
    .from("sales_tax_settings")
    .select("gst_registered, gst_number, qst_registered, qst_number, filing_frequency, itc_claim_bp, show_psb_rebate, updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as TaxSettings | null) ?? null;
}

export async function listTaxPeriods(supabase: Client, organizationId: string): Promise<TaxPeriod[]> {
  const { data, error } = await supabase
    .from("sales_tax_period")
    .select("id, starts_on, ends_on, status, gst_collected_cents, gst_claimed_cents, qst_collected_cents, qst_claimed_cents, closing_entry_id, closed_at")
    .eq("organization_id", organizationId)
    .order("starts_on", { ascending: false });
  if (error) throw new Error(`Could not load the tax periods: ${error.message}`);
  return (data ?? []) as TaxPeriod[];
}

export async function getTaxPeriod(supabase: Client, periodId: string): Promise<TaxPeriod | null> {
  const { data } = await supabase
    .from("sales_tax_period")
    .select("id, starts_on, ends_on, status, gst_collected_cents, gst_claimed_cents, qst_collected_cents, qst_claimed_cents, closing_entry_id, closed_at")
    .eq("id", periodId)
    .maybeSingle();
  return (data as TaxPeriod | null) ?? null;
}

export async function taxTotals(
  supabase: Client,
  organizationId: string,
  from: string,
  to: string,
): Promise<TaxTotalsRow[]> {
  const { data, error } = await supabase.rpc("sales_tax_totals", {
    p_organization: organizationId,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`Could not load the tax totals: ${error.message}`);
  return ((data ?? []) as TaxTotalsRow[]).map((r) => ({
    ...r,
    line_count: Number(r.line_count),
    amount_cents: Number(r.amount_cents),
    gst_cents: Number(r.gst_cents),
    qst_cents: Number(r.qst_cents),
    itc_cents: Number(r.itc_cents),
    itr_cents: Number(r.itr_cents),
  }));
}

export interface LineFilter {
  from: string;
  to: string;
  direction?: Direction | null;
  codes?: readonly TaxCode[] | null;
}

export async function listTaxLines(
  supabase: Client,
  organizationId: string,
  filter: LineFilter,
): Promise<{ lines: TaxLine[]; truncated: boolean }> {
  let query = supabase
    .from("sales_tax_line")
    .select("id, direction, tax_code, transaction_date, counterparty, reference, description, amount_cents, gst_cents, qst_cents, itc_cents, itr_cents, source_type, source_id")
    .eq("organization_id", organizationId)
    .gte("transaction_date", filter.from)
    .lte("transaction_date", filter.to);
  if (filter.direction) query = query.eq("direction", filter.direction);
  if (filter.codes && filter.codes.length > 0) query = query.in("tax_code", [...filter.codes]);
  const { data, error } = await query
    .order("transaction_date")
    .order("created_at")
    .limit(LINE_LIMIT + 1);
  if (error) throw new Error(`Could not load the tax lines: ${error.message}`);
  const lines = (data ?? []) as TaxLine[];
  return { lines: lines.slice(0, LINE_LIMIT), truncated: lines.length > LINE_LIMIT };
}

export interface Worksheet {
  gst: ReturnLine[];
  qst: ReturnLine[];
  rebate: ReturnType<typeof psbRebate>;
  closing: ReturnType<typeof closingFigures>;
  lineCount: number;
}

export function buildWorksheet(rows: TaxTotalsRow[]): Worksheet {
  return {
    gst: gstReturnLines(rows),
    qst: qstReturnLines(rows),
    rebate: psbRebate(rows),
    closing: closingFigures(rows),
    lineCount: rows.reduce((n, r) => n + r.line_count, 0),
  };
}

export const DIRECTION_LABEL: Record<Direction, MessageKey> = {
  sale: "finance.salesTax.directions.sale",
  purchase: "finance.salesTax.directions.purchase",
};

/**
 * The worksheet and every line behind it, for the accountant. Figures are
 * plain decimals so a spreadsheet can re-add them. Headings follow `t`'s
 * language (English by default).
 */
export function worksheetCsv(
  from: string,
  to: string,
  worksheet: Worksheet,
  lines: TaxLine[],
  includeRebate: boolean,
  t: TranslateFn = createTranslator("en"),
): string {
  const gst = t("finance.common.gst");
  const qst = t("finance.common.qst");
  const rows: (string | number | null)[][] = [
    [t("finance.salesTax.csv.title"), t("finance.salesTax.periodRange", { from, to })],
    [t("finance.salesTax.csv.note")],
    [],
    [
      t("finance.salesTax.csv.colReturn"),
      t("finance.salesTax.csv.colLine"),
      t("finance.salesTax.csv.colDescription"),
      t("finance.salesTax.csv.colAmount"),
    ],
    ...worksheet.gst.map((l) => [gst, l.line, t(l.label), centsToDecimal(l.cents)]),
    ...worksheet.qst.map((l) => [qst, l.line, t(l.label), centsToDecimal(l.cents)]),
  ];
  if (includeRebate) {
    const rebate = t("finance.salesTax.csv.rebate");
    rows.push(
      [],
      [t("finance.salesTax.csv.rebateHeading")],
      [rebate, "", t("finance.salesTax.csv.gstPaidNotClaimed"), centsToDecimal(worksheet.rebate.gstPaidNotClaimed)],
      [rebate, "", t("finance.salesTax.csv.gstRebate"), centsToDecimal(worksheet.rebate.gstRebate)],
      [rebate, "", t("finance.salesTax.csv.qstPaidNotClaimed"), centsToDecimal(worksheet.rebate.qstPaidNotClaimed)],
      [rebate, "", t("finance.salesTax.csv.qstRebate"), centsToDecimal(worksheet.rebate.qstRebate)],
    );
  }
  rows.push(
    [],
    [
      t("finance.salesTax.csv.colDate"),
      t("finance.salesTax.csv.colDirection"),
      t("finance.salesTax.csv.colTaxCode"),
      t("finance.salesTax.csv.colCounterparty"),
      t("finance.salesTax.csv.colReference"),
      t("finance.salesTax.csv.colDescription"),
      t("finance.salesTax.csv.colAmountBeforeTax"),
      t("finance.salesTax.csv.colGst"),
      t("finance.salesTax.csv.colQst"),
      t("finance.salesTax.csv.colItc"),
      t("finance.salesTax.csv.colItr"),
      t("finance.salesTax.csv.colSource"),
      t("finance.salesTax.csv.colSourceId"),
    ],
    ...lines.map((l) => [
      l.transaction_date,
      t(DIRECTION_LABEL[l.direction]),
      t(TAX_CODE_LABEL[l.tax_code]),
      l.counterparty,
      l.reference,
      l.description,
      centsToDecimal(l.amount_cents),
      centsToDecimal(l.gst_cents),
      centsToDecimal(l.qst_cents),
      centsToDecimal(l.itc_cents),
      centsToDecimal(l.itr_cents),
      l.source_type,
      l.source_id,
    ]),
  );
  return csvDocument(rows);
}
