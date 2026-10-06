/**
 * Payables and receivables (#150): labels, aging arithmetic and CSV. Amounts
 * are integer cents end to end, as in the ledger.
 */
import { centsToDecimal, csvDocument } from "@/features/ledger/money";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

export const DOCUMENT_KINDS = ["bill", "invoice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentStatus = "draft" | "posted" | "paid" | "void";

export const STATUS_LABEL: Record<DocumentStatus, MessageKey> = {
  draft: "finance.payables.status.draft",
  posted: "finance.payables.status.posted",
  paid: "finance.payables.status.paid",
  void: "finance.payables.status.void",
};

export const STATUS_TONE: Record<DocumentStatus, "warning" | "info" | "success" | "neutral"> = {
  draft: "warning",
  posted: "info",
  paid: "success",
  void: "neutral",
};

export const PAYMENT_METHODS = ["eft", "cheque", "card", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, MessageKey> = {
  eft: "finance.payables.paymentMethods.eft",
  cheque: "finance.payables.paymentMethods.cheque",
  card: "finance.payables.paymentMethods.card",
  cash: "finance.payables.paymentMethods.cash",
  other: "finance.payables.paymentMethods.other",
};

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL: Record<AgingBucket, MessageKey> = {
  current: "finance.payables.agingBuckets.current",
  "1-30": "finance.payables.agingBuckets.days1to30",
  "31-60": "finance.payables.agingBuckets.days31to60",
  "61-90": "finance.payables.agingBuckets.days61to90",
  "90+": "finance.payables.agingBuckets.over90",
};

export interface AgingRow {
  document_id: string;
  contact_id: string;
  contact_name: string;
  reference: string | null;
  document_date: string;
  due_date: string;
  control_account_id: string;
  total_cents: number;
  open_cents: number;
  days_past_due: number;
  bucket: AgingBucket;
}

export type BucketTotals = Record<AgingBucket, number> & { total: number };

function emptyTotals(): BucketTotals {
  return { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
}

/** Totals per bucket, overall and per contact (contacts in name order). */
export function summarizeAging(rows: AgingRow[]): {
  totals: BucketTotals;
  contacts: { contactId: string; name: string; totals: BucketTotals }[];
} {
  const totals = emptyTotals();
  const byContact = new Map<string, { contactId: string; name: string; totals: BucketTotals }>();
  for (const row of rows) {
    const cents = Number(row.open_cents);
    totals[row.bucket] += cents;
    totals.total += cents;
    let contact = byContact.get(row.contact_id);
    if (!contact) {
      contact = { contactId: row.contact_id, name: row.contact_name, totals: emptyTotals() };
      byContact.set(row.contact_id, contact);
    }
    contact.totals[row.bucket] += cents;
    contact.totals.total += cents;
  }
  const contacts = [...byContact.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { totals, contacts };
}

/** The aging as CSV. Headings follow `t` (the requester's language); amounts stay machine-readable. */
export function agingCsv(
  kind: DocumentKind,
  asOf: string,
  rows: AgingRow[],
  t: TranslateFn = createTranslator("en"),
): string {
  const { totals } = summarizeAging(rows);
  const title = t(kind === "bill" ? "finance.payables.csv.payablesTitle" : "finance.payables.csv.receivablesTitle");
  return csvDocument([
    [title, t("finance.payables.csv.asAt", { date: asOf })],
    [],
    [
      t(kind === "bill" ? "finance.payables.csv.vendor" : "finance.payables.csv.customer"),
      t(kind === "bill" ? "finance.payables.csv.vendorInvoice" : "finance.payables.csv.invoice"),
      t("finance.payables.csv.date"),
      t("finance.payables.csv.due"),
      t("finance.payables.csv.daysPastDue"),
      t("finance.payables.csv.bucket"),
      t("finance.payables.csv.total"),
      t("finance.payables.csv.open"),
    ],
    ...rows.map((r) => [
      r.contact_name,
      r.reference ?? "",
      r.document_date,
      r.due_date,
      r.days_past_due,
      t(AGING_BUCKET_LABEL[r.bucket]),
      centsToDecimal(Number(r.total_cents)),
      centsToDecimal(Number(r.open_cents)),
    ]),
    [],
    ...AGING_BUCKETS.map((b) => ["", "", "", "", "", t(AGING_BUCKET_LABEL[b]), "", centsToDecimal(totals[b])]),
    ["", "", "", "", "", t("finance.payables.csv.total"), "", centsToDecimal(totals.total)],
  ]);
}

/** Adds days to a YYYY-MM-DD date, in UTC so no time zone shifts it. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "INV-0042" for invoice number 42; `draft` (translated by the caller) before it has one. */
export function invoiceLabel(number: number | null, draft: string = "Draft"): string {
  return number === null ? draft : `INV-${String(number).padStart(4, "0")}`;
}


/**
 * `t()` for the wording of a printed invoice (`finance.payables.invoiceSheet`),
 * in the customer's language whatever language the reader uses.
 */
export function invoiceTranslator(language: "fr" | "en"): TranslateFn {
  return createTranslator(language === "fr" ? "fr-CA" : "en");
}

export function formatCentsIn(language: "fr" | "en", cents: number): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}
