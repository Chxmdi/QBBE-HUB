/**
 * Payables and receivables (#150): labels, aging arithmetic and CSV. Amounts
 * are integer cents end to end, as in the ledger.
 */
import { centsToDecimal, csvDocument } from "@/features/ledger/money";

export const DOCUMENT_KINDS = ["bill", "invoice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentStatus = "draft" | "posted" | "paid" | "void";

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "Draft",
  posted: "Open",
  paid: "Paid",
  void: "Void",
};

export const STATUS_TONE: Record<DocumentStatus, "warning" | "info" | "success" | "neutral"> = {
  draft: "warning",
  posted: "info",
  paid: "success",
  void: "neutral",
};

export const PAYMENT_METHODS = ["eft", "cheque", "card", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  eft: "Bank transfer (EFT)",
  cheque: "Cheque",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

export const AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  current: "Not yet due",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "Over 90 days",
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

export function agingCsv(kind: DocumentKind, asOf: string, rows: AgingRow[]): string {
  const { totals } = summarizeAging(rows);
  const title = kind === "bill" ? "Accounts payable aging" : "Accounts receivable aging";
  return csvDocument([
    [title, `As at ${asOf}`],
    [],
    [
      kind === "bill" ? "Vendor" : "Customer",
      kind === "bill" ? "Vendor invoice" : "Invoice",
      "Date",
      "Due",
      "Days past due",
      "Bucket",
      "Total",
      "Open",
    ],
    ...rows.map((r) => [
      r.contact_name,
      r.reference ?? "",
      r.document_date,
      r.due_date,
      r.days_past_due,
      AGING_BUCKET_LABEL[r.bucket],
      centsToDecimal(Number(r.total_cents)),
      centsToDecimal(Number(r.open_cents)),
    ]),
    [],
    ...AGING_BUCKETS.map((b) => ["", "", "", "", "", AGING_BUCKET_LABEL[b], "", centsToDecimal(totals[b])]),
    ["", "", "", "", "", "Total", "", centsToDecimal(totals.total)],
  ]);
}

/** Adds days to a YYYY-MM-DD date, in UTC so no time zone shifts it. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "INV-0042" for invoice number 42. */
export function invoiceLabel(number: number | null): string {
  return number === null ? "Draft" : `INV-${String(number).padStart(4, "0")}`;
}

/** Wording of a printed invoice, in the customer's language. */
export const INVOICE_WORDS = {
  fr: {
    invoice: "Facture",
    number: "Numéro",
    date: "Date",
    due: "Échéance",
    billTo: "Facturé à",
    description: "Description",
    amount: "Montant",
    subtotal: "Sous-total",
    gst: "TPS",
    qst: "TVQ",
    total: "Total",
    paid: "Payé",
    balance: "Solde dû",
    draft: "Brouillon — non émise",
    void: "Annulée",
  },
  en: {
    invoice: "Invoice",
    number: "Number",
    date: "Date",
    due: "Due",
    billTo: "Bill to",
    description: "Description",
    amount: "Amount",
    subtotal: "Subtotal",
    gst: "GST",
    qst: "QST",
    total: "Total",
    paid: "Paid",
    balance: "Balance due",
    draft: "Draft — not issued",
    void: "Void",
  },
} as const;

export function formatCentsIn(language: "fr" | "en", cents: number): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}
