"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction, requireStaff } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText, isCalendarDate } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/ledger/money";
import { DOCUMENT_KINDS, PAYMENT_METHODS } from "@/features/payables/model";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Payables and receivables actions (#150). Staff draft bills, invoices and
 * contacts; posting, payments, voids and reversals are for owners and admins
 * who completed MFA. The database checks all of it again, keeps the ledger's
 * rules, refuses paying beyond a total and writes the audit records.
 */

const ROOT = "/finance/payables";

type DbError = { code?: string; message: string } | null;

const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(t: TranslateFn, error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23505" && /uq_finance_bill_vendor_reference/.test(error.message)) {
    return t("finance.payables.errors.duplicateVendorReference");
  }
  if (error.code === "23505" && /uq_finance_bill_receipt/.test(error.message)) {
    return t("finance.payables.errors.duplicateReceipt");
  }
  if (error.code === "23503") return t("finance.payables.errors.foreignKey");
  if (error.code === "23514" && /due_after/.test(error.message)) return t("finance.payables.errors.dueBeforeDate");
  if (error.code === "23514" && /violates check constraint/i.test(error.message)) return t("finance.payables.errors.checkValues");
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * The first validation problem, in the reader's language. The schemas carry
 * catalogue keys; a message that is not a key (zod's own) shows as it is.
 */
function issueMessage(t: TranslateFn, error: z.ZodError): string | undefined {
  const message = error.issues[0]?.message;
  return message === undefined ? undefined : t(message as MessageKey);
}

const isoDate = (message: MessageKey) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message).refine(isCalendarDate, message);
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .pipe(z.string().uuid().nullable());

const money = (message: MessageKey, required: boolean) =>
  z
    .string()
    .nullish()
    .transform((raw, ctx) => {
      const value = (raw ?? "").trim();
      if (value === "" && !required) return 0;
      const cents = parseMoneyToCents(value);
      if (cents === null || (required && cents <= 0)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return cents;
    });

async function staff(): Promise<{ ok: true; organizationId: string } | { ok: false; result: ActionResult }> {
  const session = await requireStaff();
  const limited = await enforceRateLimit("payables:write", session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: session.organizationId };
}

async function admin(): Promise<{ ok: true; organizationId: string } | { ok: false; result: ActionResult }> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit("payables:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

function refresh() {
  revalidatePath(ROOT, "layout");
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z
  .object({
    id: optionalId,
    name: requiredText("finance.payables.validation.name", 200),
    isVendor: z.boolean(),
    isCustomer: z.boolean(),
    email: z.string().trim().max(320).optional(),
    phone: z.string().trim().max(50).optional(),
    address: z.string().trim().max(1000).optional(),
    language: z.enum(["fr", "en"]).default("fr"),
    gstNumber: z.string().trim().max(30).optional(),
    qstNumber: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(2000).optional(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.isVendor || c.isCustomer, {
    message: "finance.payables.validation.vendorOrCustomer" satisfies MessageKey,
    path: ["isVendor"],
  });

export async function saveContact(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await staff();
  if (!auth.ok) return auth.result;
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error) };
  const c = parsed.data;
  const row = {
    name: c.name,
    is_vendor: c.isVendor,
    is_customer: c.isCustomer,
    email: c.email || null,
    phone: c.phone || null,
    address: c.address || null,
    language: c.language,
    gst_number: c.gstNumber || null,
    qst_number: c.qstNumber || null,
    notes: c.notes || null,
    is_active: c.isActive,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = c.id
    ? await supabase.from("finance_contact").update(row).eq("id", c.id).select("id").maybeSingle()
    : await supabase
        .from("finance_contact")
        .insert({ ...row, organization_id: auth.organizationId })
        .select("id")
        .single();
  if (error || !data) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.saveContact")) };
  refresh();
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Drafting bills and invoices
// ---------------------------------------------------------------------------

const lineSchema = z.object({
  accountId: optionalId,
  programId: optionalId,
  description: z.string().trim().max(500).optional(),
  amount: money("finance.payables.validation.lineAmount", true),
});

const documentSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  id: optionalId,
  contactId: requiredText("finance.payables.validation.contact").uuid("finance.payables.validation.contact"),
  receiptId: optionalId,
  reference: z.string().trim().max(100).optional(),
  language: z.enum(["fr", "en"]).default("fr"),
  documentDate: isoDate("finance.payables.validation.documentDate"),
  dueDate: isoDate("finance.payables.validation.dueDate"),
  memo: z.string().trim().max(500).optional(),
  fundId: optionalId,
  controlAccountId: optionalId,
  gst: money("finance.payables.validation.gstAmount", false),
  qst: money("finance.payables.validation.qstAmount", false),
  lines: z.array(lineSchema).min(1, "finance.payables.validation.atLeastOneLine").max(200),
  post: z.boolean().default(false),
});

/**
 * Saves a draft bill or invoice; with `post`, an admin then posts it in a
 * second step. A post that fails leaves the saved draft and says why.
 */
export async function saveDocument(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error) ?? t("finance.payables.errors.checkDetails") };
  const d = parsed.data;
  if (d.dueDate < d.documentDate) return { ok: false, error: t("finance.payables.errors.dueBeforeDate") };
  if (d.kind === "invoice" && d.lines.some((l) => !l.description)) {
    return { ok: false, error: t("finance.payables.errors.invoiceLineDescription") };
  }
  const auth = d.post ? await admin() : await staff();
  if (!auth.ok) return auth.result;
  const supabase = await createSupabaseServerClient();

  const lines = d.lines.map((l) => ({
    account_id: l.accountId,
    program_id: l.programId,
    description: l.description ?? "",
    amount_cents: l.amount,
  }));
  const common = {
    document_date: d.documentDate,
    due_date: d.dueDate,
    memo: d.memo ?? "",
    fund_id: d.fundId,
    gst_cents: d.gst,
    qst_cents: d.qst,
  };
  const { data: id, error } =
    d.kind === "bill"
      ? await supabase.rpc("finance_save_bill", {
          p_organization: auth.organizationId,
          p_bill: d.id,
          p_header: {
            ...common,
            bill_date: d.documentDate,
            vendor_id: d.contactId,
            receipt_id: d.receiptId,
            vendor_reference: d.reference ?? "",
            payable_account_id: d.controlAccountId,
          },
          p_lines: lines,
        })
      : await supabase.rpc("finance_save_invoice", {
          p_organization: auth.organizationId,
          p_invoice: d.id,
          p_header: {
            ...common,
            invoice_date: d.documentDate,
            customer_id: d.contactId,
            language: d.language,
            receivable_account_id: d.controlAccountId,
          },
          p_lines: lines,
        });
  if (error || !id) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.save")) };
  refresh();
  if (!d.post) return { ok: true, id: id as string };

  const posted = await supabase.rpc(d.kind === "bill" ? "finance_post_bill" : "finance_post_invoice", {
    [d.kind === "bill" ? "p_bill" : "p_invoice"]: id,
  });
  if (posted.error) {
    return {
      ok: false,
      id: id as string,
      error: t("finance.payables.errors.savedNotPosted", {
        reason: dbMessage(t, posted.error, t("finance.payables.errors.tryAgain")),
      }),
    };
  }
  return { ok: true, id: id as string };
}

const refSchema = z.object({ kind: z.enum(DOCUMENT_KINDS), id: z.string().uuid() });

export async function deleteDraft(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await staff();
  if (!auth.ok) return auth.result;
  const parsed = refSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("finance.payables.errors.documentNotFound") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finance_delete_draft", { p_kind: parsed.data.kind, p_id: parsed.data.id });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.deleteDraft")) };
  refresh();
  return { ok: true };
}

export async function postDocument(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await admin();
  if (!auth.ok) return auth.result;
  const parsed = refSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("finance.payables.errors.documentNotFound") };
  const { kind, id } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc(kind === "bill" ? "finance_post_bill" : "finance_post_invoice", {
    [kind === "bill" ? "p_bill" : "p_invoice"]: id,
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.post")) };
  refresh();
  return { ok: true, id };
}

export async function requestBillApproval(billId: string): Promise<ActionResult> {
  const t = await getT();
  const auth = await staff();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(billId).success) return { ok: false, error: t("finance.payables.errors.billNotFound") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("finance_request_bill_approval", { p_bill: billId });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.requestApproval")) };
  refresh();
  return { ok: true, id: data as string };
}

// ---------------------------------------------------------------------------
// Payments, voids, reversals (admins with MFA)
// ---------------------------------------------------------------------------

const paymentSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  documentId: z.string().uuid(),
  paidOn: isoDate("finance.payables.validation.paymentDate"),
  amount: money("finance.payables.validation.paymentAmount", true),
  bankAccountId: requiredText("finance.payables.validation.bankAccount").uuid("finance.payables.validation.bankAccount"),
  method: z.enum(PAYMENT_METHODS, { message: "finance.payables.validation.method" }),
  reference: z.string().trim().max(100).optional(),
});

export async function recordPayment(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await admin();
  if (!auth.ok) return auth.result;
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error) };
  const p = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("finance_record_payment", {
    p_kind: p.kind,
    p_document: p.documentId,
    p_paid_on: p.paidOn,
    p_amount_cents: p.amount,
    p_bank_account: p.bankAccountId,
    p_method: p.method,
    p_reference: p.reference ?? "",
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.recordPayment")) };
  refresh();
  return { ok: true, id: data as string };
}

const reverseSchema = z.object({
  paymentId: z.string().uuid(),
  date: isoDate("finance.payables.validation.reversalDate"),
  reason: z.string().trim().max(400).optional(),
});

export async function reversePayment(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await admin();
  if (!auth.ok) return auth.result;
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finance_reverse_payment", {
    p_payment: parsed.data.paymentId,
    p_date: parsed.data.date,
    p_reason: parsed.data.reason ?? "",
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.reversePayment")) };
  refresh();
  return { ok: true };
}

const voidSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  id: z.string().uuid(),
  date: isoDate("finance.payables.validation.voidDate"),
  reason: requiredText("finance.payables.validation.voidReason", 400),
});

export async function voidDocument(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await admin();
  if (!auth.ok) return auth.result;
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(t, parsed.error) };
  const v = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finance_void_document", {
    p_kind: v.kind,
    p_id: v.id,
    p_date: v.date,
    p_reason: v.reason,
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.void")) };
  refresh();
  return { ok: true };
}

const thresholdSchema = z.object({ threshold: z.string().trim().max(30).optional() });

export async function setBillApprovalThreshold(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const auth = await admin();
  if (!auth.ok) return auth.result;
  const parsed = thresholdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("finance.payables.errors.thresholdAmount") };
  const raw = parsed.data.threshold ?? "";
  const cents = raw === "" ? null : parseMoneyToCents(raw);
  if (raw !== "" && cents === null) return { ok: false, error: t("finance.payables.errors.thresholdAmountExample") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("finance_set_bill_approval_threshold", {
    p_organization: auth.organizationId,
    p_threshold_cents: cents,
  });
  if (error) return { ok: false, error: dbMessage(t, error, t("finance.payables.errors.saveThreshold")) };
  refresh();
  return { ok: true };
}
