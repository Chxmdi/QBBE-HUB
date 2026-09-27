import { requireStaff, type SessionContext } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import type { Choice } from "@/features/ledger/components/entry-form";
import type { DocumentKind, DocumentStatus } from "@/features/payables/model";

type Client = Awaited<ReturnType<typeof createSupabasePageClient>>;

export interface PayablesAccess {
  session: SessionContext;
  supabase: Client;
  /** Owners/admins: may post, pay and void. The database also requires MFA. */
  canPost: boolean;
}

/** Route gate: staff reach payables; row-level security decides what they see. */
export async function getPayablesAccess(): Promise<PayablesAccess> {
  const session = await requireStaff();
  const supabase = await createSupabasePageClient();
  return { session, supabase, canPost: session.isAdmin };
}

export interface AccountChoice extends Choice {
  code: string;
  accountType: string;
}

export interface PostingChoices {
  accounts: AccountChoice[];
  funds: (Choice & { code: string })[];
  programs: Choice[];
}

/** Account, fund and program names for drafting. Staff do not read the ledger itself. */
export async function loadPostingChoices(supabase: Client, organizationId: string): Promise<PostingChoices> {
  const [choices, programs] = await Promise.all([
    supabase.rpc("finance_posting_choices", { p_organization: organizationId }),
    supabase.from("program").select("id, name").eq("organization_id", organizationId).order("name"),
  ]);
  const rows = (choices.data ?? []) as {
    choice: "account" | "fund";
    id: string;
    code: string;
    name: string;
    account_type: string;
  }[];
  return {
    accounts: rows
      .filter((r) => r.choice === "account")
      .map((r) => ({ id: r.id, code: r.code, accountType: r.account_type, label: `${r.code} ${r.name}` })),
    funds: rows.filter((r) => r.choice === "fund").map((r) => ({ id: r.id, code: r.code, label: `${r.code} ${r.name}` })),
    programs: ((programs.data ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
  };
}

export interface ContactRow {
  id: string;
  name: string;
  is_vendor: boolean;
  is_customer: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  language: "fr" | "en";
  gst_number: string | null;
  qst_number: string | null;
  notes: string | null;
  is_active: boolean;
}

export async function loadContacts(supabase: Client, organizationId: string): Promise<ContactRow[]> {
  const { data } = await supabase
    .from("finance_contact")
    .select("id, name, is_vendor, is_customer, email, phone, address, language, gst_number, qst_number, notes, is_active")
    .eq("organization_id", organizationId)
    .order("name");
  return (data ?? []) as ContactRow[];
}

export interface DocumentLine {
  line_no: number;
  account_id: string | null;
  program_id: string | null;
  description: string | null;
  amount_cents: number;
}

export interface DocumentRecord {
  kind: DocumentKind;
  id: string;
  contact_id: string;
  contact_name: string;
  contact_address: string | null;
  reference: string | null;
  invoice_number: number | null;
  language: "fr" | "en";
  receipt_id: string | null;
  document_date: string;
  due_date: string;
  memo: string | null;
  fund_id: string | null;
  control_account_id: string | null;
  subtotal_cents: number;
  gst_cents: number;
  qst_cents: number;
  total_cents: number;
  paid_cents: number;
  status: DocumentStatus;
  journal_entry_id: string | null;
  void_entry_id: string | null;
  voided_on: string | null;
  created_by: string | null;
  lines: DocumentLine[];
  payments: PaymentRow[];
}

export interface PaymentRow {
  id: string;
  paid_on: string;
  amount_cents: number;
  method: string;
  reference: string | null;
  bank_account_id: string;
  journal_entry_id: string;
  reversed_on: string | null;
}

const PAYMENT_FIELDS = "id, paid_on, amount_cents, method, reference, bank_account_id, journal_entry_id, reversed_on";

export async function loadDocument(supabase: Client, kind: DocumentKind, id: string): Promise<DocumentRecord | null> {
  if (kind === "bill") {
    const { data } = await supabase
      .from("finance_bill")
      .select(
        `id, vendor_id, vendor_reference, receipt_id, bill_date, due_date, memo, fund_id, payable_account_id,
         subtotal_cents, gst_cents, qst_cents, total_cents, paid_cents, status, journal_entry_id, void_entry_id,
         voided_on, created_by, vendor:finance_contact!finance_bill_organization_id_vendor_id_fkey(name, address, language),
         finance_bill_line(line_no, account_id, program_id, description, amount_cents),
         finance_payment(${PAYMENT_FIELDS})`,
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const b = data as unknown as Record<string, unknown> & {
      vendor: { name: string; address: string | null; language: "fr" | "en" } | null;
      finance_bill_line: DocumentLine[];
      finance_payment: PaymentRow[];
    };
    return {
      kind,
      id: b.id as string,
      contact_id: b.vendor_id as string,
      contact_name: b.vendor?.name ?? "",
      contact_address: b.vendor?.address ?? null,
      reference: b.vendor_reference as string | null,
      invoice_number: null,
      language: b.vendor?.language ?? "fr",
      receipt_id: b.receipt_id as string | null,
      document_date: b.bill_date as string,
      due_date: b.due_date as string,
      memo: b.memo as string | null,
      fund_id: b.fund_id as string | null,
      control_account_id: b.payable_account_id as string | null,
      subtotal_cents: Number(b.subtotal_cents),
      gst_cents: Number(b.gst_cents),
      qst_cents: Number(b.qst_cents),
      total_cents: Number(b.total_cents),
      paid_cents: Number(b.paid_cents),
      status: b.status as DocumentStatus,
      journal_entry_id: b.journal_entry_id as string | null,
      void_entry_id: b.void_entry_id as string | null,
      voided_on: b.voided_on as string | null,
      created_by: b.created_by as string | null,
      lines: [...b.finance_bill_line].sort((x, y) => x.line_no - y.line_no),
      payments: [...b.finance_payment].sort((x, y) => x.paid_on.localeCompare(y.paid_on)),
    };
  }
  const { data } = await supabase
    .from("finance_invoice")
    .select(
      `id, customer_id, invoice_number, language, invoice_date, due_date, memo, fund_id, receivable_account_id,
       subtotal_cents, gst_cents, qst_cents, total_cents, paid_cents, status, journal_entry_id, void_entry_id,
       voided_on, created_by, customer:finance_contact!finance_invoice_organization_id_customer_id_fkey(name, address),
       finance_invoice_line(line_no, account_id, program_id, description, amount_cents),
       finance_payment(${PAYMENT_FIELDS})`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const i = data as unknown as Record<string, unknown> & {
    customer: { name: string; address: string | null } | null;
    finance_invoice_line: DocumentLine[];
    finance_payment: PaymentRow[];
  };
  return {
    kind,
    id: i.id as string,
    contact_id: i.customer_id as string,
    contact_name: i.customer?.name ?? "",
    contact_address: i.customer?.address ?? null,
    reference: null,
    invoice_number: (i.invoice_number as number | null) ?? null,
    language: (i.language as "fr" | "en") ?? "fr",
    receipt_id: null,
    document_date: i.invoice_date as string,
    due_date: i.due_date as string,
    memo: i.memo as string | null,
    fund_id: i.fund_id as string | null,
    control_account_id: i.receivable_account_id as string | null,
    subtotal_cents: Number(i.subtotal_cents),
    gst_cents: Number(i.gst_cents),
    qst_cents: Number(i.qst_cents),
    total_cents: Number(i.total_cents),
    paid_cents: Number(i.paid_cents),
    status: i.status as DocumentStatus,
    journal_entry_id: i.journal_entry_id as string | null,
    void_entry_id: i.void_entry_id as string | null,
    voided_on: i.voided_on as string | null,
    created_by: i.created_by as string | null,
    lines: [...i.finance_invoice_line].sort((x, y) => x.line_no - y.line_no),
    payments: [...i.finance_payment].sort((x, y) => x.paid_on.localeCompare(y.paid_on)),
  };
}

export interface DocumentListRow {
  id: string;
  contact_name: string;
  reference: string | null;
  document_date: string;
  due_date: string;
  total_cents: number;
  paid_cents: number;
  status: DocumentStatus;
}

export async function listDocuments(
  supabase: Client,
  organizationId: string,
  kind: DocumentKind,
  status: DocumentStatus | "",
): Promise<DocumentListRow[]> {
  if (kind === "bill") {
    let q = supabase
      .from("finance_bill")
      .select(
        "id, vendor_reference, bill_date, due_date, total_cents, paid_cents, status, vendor:finance_contact!finance_bill_organization_id_vendor_id_fkey(name)",
      )
      .eq("organization_id", organizationId);
    if (status) q = q.eq("status", status);
    const { data } = await q.order("bill_date", { ascending: false }).limit(500);
    return ((data ?? []) as unknown as (Record<string, unknown> & { vendor: { name: string } | null })[]).map((b) => ({
      id: b.id as string,
      contact_name: b.vendor?.name ?? "",
      reference: b.vendor_reference as string | null,
      document_date: b.bill_date as string,
      due_date: b.due_date as string,
      total_cents: Number(b.total_cents),
      paid_cents: Number(b.paid_cents),
      status: b.status as DocumentStatus,
    }));
  }
  let q = supabase
    .from("finance_invoice")
    .select(
      "id, invoice_number, invoice_date, due_date, total_cents, paid_cents, status, customer:finance_contact!finance_invoice_organization_id_customer_id_fkey(name)",
    )
    .eq("organization_id", organizationId);
  if (status) q = q.eq("status", status);
  const { data } = await q.order("invoice_date", { ascending: false }).limit(500);
  return ((data ?? []) as unknown as (Record<string, unknown> & { customer: { name: string } | null })[]).map((i) => ({
    id: i.id as string,
    contact_name: i.customer?.name ?? "",
    reference: i.invoice_number === null ? null : String(i.invoice_number),
    document_date: i.invoice_date as string,
    due_date: i.due_date as string,
    total_cents: Number(i.total_cents),
    paid_cents: Number(i.paid_cents),
    status: i.status as DocumentStatus,
  }));
}
