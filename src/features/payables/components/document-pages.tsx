import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/ledger/money";
import { todayIn } from "@/features/ledger/services/ledger.access";
import { DocumentForm, type DocumentFormValue } from "@/features/payables/components/document-form";
import {
  DraftActions,
  PaymentDialog,
  ReversePaymentButton,
  VoidDialog,
} from "@/features/payables/components/document-actions";
import { InvoiceSheet, PrintButton } from "@/features/payables/components/invoice-sheet";
import { PayablesTabs } from "@/features/payables/components/payables-tabs";
import { ThresholdForm } from "@/features/payables/components/threshold-form";
import {
  INVOICE_WORDS,
  PAYMENT_METHOD_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  addDays,
  invoiceLabel,
  type DocumentKind,
  type DocumentStatus,
  type PaymentMethod,
} from "@/features/payables/model";
import {
  getPayablesAccess,
  listDocuments,
  loadContacts,
  loadDocument,
  loadPostingChoices,
  type DocumentRecord,
} from "@/features/payables/services/payables.queries";

/**
 * What the bill page says about its approval (#143). Posting needs the bill's
 * own request approved while the bill still matches what was sent.
 */
const APPROVAL_NOTE: Record<string, string> = {
  none: "Send it for approval; it can be posted once approved.",
  pending: "It is waiting for approval.",
  approved: "It is approved and ready to post.",
  rejected: "Its approval was rejected. Change it if needed, then send it again.",
  withdrawn: "Its approval request was withdrawn. Send it again when it is ready.",
  changed: "It changed after it was sent for approval, so it needs to be sent again.",
};

const linkButton =
  "inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong";

function paths(kind: DocumentKind) {
  return kind === "bill"
    ? { list: "/finance/payables", base: "/finance/payables/bills" }
    : { list: "/finance/payables/invoices", base: "/finance/payables/invoices" };
}

function referenceLabel(kind: DocumentKind, reference: string | null): string {
  if (kind === "invoice") return invoiceLabel(reference === null ? null : Number(reference));
  return reference ?? "—";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function DocumentListPage({
  kind,
  searchParams,
}: {
  kind: DocumentKind;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canPost } = await getPayablesAccess();
  const params = await searchParams;
  const status = (["draft", "posted", "paid", "void"] as const).includes(params.status as DocumentStatus)
    ? (params.status as DocumentStatus)
    : "";
  const rows = await listDocuments(supabase, session.organizationId, kind, status);
  const isBill = kind === "bill";
  let threshold: number | null = null;
  if (isBill) {
    const { data } = await supabase
      .from("finance_billing_settings")
      .select("bill_approval_threshold_cents")
      .eq("organization_id", session.organizationId)
      .maybeSingle();
    threshold = data?.bill_approval_threshold_cents ?? null;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Bills and invoices"
        description={
          isBill
            ? "Bills from vendors. Staff enter them; an administrator posts them to the ledger and records each payment. A bill can never be paid beyond its total."
            : "Invoices to partners, funders and members, in French or English. Posting records the amount owed; each payment received reduces it."
        }
        actions={
          <Link href={`${paths(kind).base}/new`} className={linkButton}>
            <Plus className="size-4" aria-hidden />
            {isBill ? "New bill" : "New invoice"}
          </Link>
        }
      />
      <PayablesTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label="Filter">
        <div>
          <Label htmlFor="doc-status">Status</Label>
          <Select id="doc-status" name="status" defaultValue={status}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="posted">Open</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={status ? "Nothing with this status" : isBill ? "No bills yet" : "No invoices yet"}
          description={
            isBill
              ? "Enter a vendor bill, or turn a captured bill from Receipts into one."
              : "Create an invoice for a grant installment, a membership fee or a partner."
          }
        />
      ) : (
        <DataTable minWidth="760px">
          <TableHead>
            <TableHeader className="w-28">Date</TableHeader>
            <TableHeader>{isBill ? "Vendor" : "Customer"}</TableHeader>
            <TableHeader className="w-32">{isBill ? "Vendor no." : "Invoice"}</TableHeader>
            <TableHeader className="w-28">Due</TableHeader>
            <TableHeader className="w-24">Status</TableHeader>
            <TableHeader className="w-32 text-right">Total</TableHeader>
            <TableHeader className="w-32 text-right">Owing</TableHeader>
          </TableHead>
          <tbody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.document_date}</TableCell>
                <TableCell>
                  <Link href={`${paths(kind).base}/${r.id}`} className="font-medium text-brand-fg hover:underline">
                    {r.contact_name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{referenceLabel(kind, r.reference)}</TableCell>
                <TableCell className="tabular-nums">{r.due_date}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(r.total_cents)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.status === "posted" ? formatCents(r.total_cents - r.paid_cents) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
      {isBill ? <ThresholdForm thresholdCents={threshold} canEdit={canPost} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form (new or edit)
// ---------------------------------------------------------------------------

async function editorProps(kind: DocumentKind, record: DocumentRecord | null) {
  const { session, supabase, canPost } = await getPayablesAccess();
  const [choices, contacts, receipts] = await Promise.all([
    loadPostingChoices(supabase, session.organizationId),
    loadContacts(supabase, session.organizationId),
    kind === "bill"
      ? supabase
          .from("finance_receipt")
          .select("id, vendor, document_date, total_cents")
          .eq("organization_id", session.organizationId)
          .eq("kind", "bill")
          .order("document_date", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  const today = todayIn(session.timeZone);
  const gen = choices.funds.find((f) => f.code === "GEN") ?? choices.funds[0];
  const lineTypes = kind === "bill" ? ["expense", "asset"] : ["revenue", "liability"];
  const controlType = kind === "bill" ? "liability" : "asset";
  const initial: DocumentFormValue = record
    ? {
        id: record.id,
        contactId: record.contact_id,
        receiptId: record.receipt_id ?? "",
        reference: record.reference ?? "",
        language: record.language,
        documentDate: record.document_date,
        dueDate: record.due_date,
        memo: record.memo ?? "",
        fundId: record.fund_id ?? gen?.id ?? "",
        controlAccountId: record.control_account_id ?? "",
        gst: record.gst_cents ? (record.gst_cents / 100).toFixed(2) : "",
        qst: record.qst_cents ? (record.qst_cents / 100).toFixed(2) : "",
        lines: record.lines.map((l) => ({
          accountId: l.account_id ?? "",
          programId: l.program_id ?? "",
          description: l.description ?? "",
          amount: (Number(l.amount_cents) / 100).toFixed(2),
        })),
      }
    : {
        contactId: "",
        receiptId: "",
        reference: "",
        language: "fr",
        documentDate: today,
        dueDate: addDays(today, 30),
        memo: "",
        fundId: gen?.id ?? "",
        controlAccountId: "",
        gst: "",
        qst: "",
        lines: [],
      };
  const usedReceipts = new Set<string>();
  if (kind === "bill") {
    const { data } = await supabase
      .from("finance_bill")
      .select("receipt_id")
      .eq("organization_id", session.organizationId)
      .neq("status", "void")
      .not("receipt_id", "is", null);
    for (const r of (data ?? []) as { receipt_id: string }[]) usedReceipts.add(r.receipt_id);
  }
  return {
    kind,
    initial,
    canPost,
    contacts: contacts
      .filter((c) => (kind === "bill" ? c.is_vendor : c.is_customer) && (c.is_active || c.id === record?.contact_id))
      .map((c) => ({ id: c.id, label: c.name, language: c.language })),
    receipts: ((receipts.data ?? []) as { id: string; vendor: string; document_date: string; total_cents: number }[])
      .filter((r) => !usedReceipts.has(r.id) || r.id === record?.receipt_id)
      .map((r) => ({ id: r.id, label: `${r.document_date} ${r.vendor} ${formatCents(Number(r.total_cents))}` })),
    accounts: choices.accounts.filter((a) => lineTypes.includes(a.accountType)),
    controlAccounts: choices.accounts.filter((a) => a.accountType === controlType),
    funds: choices.funds,
    programs: choices.programs,
  };
}

export async function NewDocumentPage({ kind }: { kind: DocumentKind }) {
  const props = await editorProps(kind, null);
  return (
    <div>
      <PageHeader
        eyebrow="Bills and invoices"
        title={kind === "bill" ? "New bill" : "New invoice"}
        description={
          kind === "bill"
            ? "Enter the bill as the vendor wrote it. Staff can leave the accounts for finance to choose before posting."
            : "The customer sees the descriptions, amounts and taxes, in the language chosen."
        }
      />
      <PayablesTabs />
      <DocumentForm {...props} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function DocumentDetailPage({
  kind,
  params,
  searchParams,
}: {
  kind: DocumentKind;
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { session, supabase, canPost } = await getPayablesAccess();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const record = await loadDocument(supabase, kind, id);
  if (!record) notFound();
  const isBill = kind === "bill";
  const noun = isBill ? "bill" : "invoice";
  const canEdit = record.status === "draft" && (record.created_by === session.userId || canPost);
  const today = todayIn(session.timeZone);

  if (query.edit === "1" && canEdit) {
    const props = await editorProps(kind, record);
    return (
      <div>
        <PageHeader eyebrow="Bills and invoices" title={`Edit draft ${noun}`} />
        <PayablesTabs />
        <DocumentForm {...props} />
      </div>
    );
  }

  const choices = await loadPostingChoices(supabase, session.organizationId);
  const accountLabel = new Map(choices.accounts.map((a) => [a.id, a.label]));
  const fundLabel = new Map(choices.funds.map((f) => [f.id, f.label]));
  const programLabel = new Map(choices.programs.map((p) => [p.id, p.label]));
  const bankAccounts = choices.accounts.filter((a) => a.accountType === "asset" && a.code.startsWith("10"));

  let approval: { status: string; approvalItemId: string | null } | null = null;
  let threshold: number | null = null;
  if (isBill && record.status === "draft") {
    const { data } = await supabase
      .from("finance_billing_settings")
      .select("bill_approval_threshold_cents")
      .eq("organization_id", session.organizationId)
      .maybeSingle();
    threshold = data?.bill_approval_threshold_cents ?? null;
    // Null when there is no approval for this total, or approvals (#143) are not installed.
    const [{ data: approvalStatus }, { data: link }] = await Promise.all([
      supabase.rpc("finance_bill_approval_status", { p_bill: record.id }),
      supabase.from("finance_bill").select("approval_item_id").eq("id", record.id).maybeSingle(),
    ]);
    approval =
      typeof approvalStatus === "string"
        ? { status: approvalStatus, approvalItemId: (link?.approval_item_id as string | null) ?? null }
        : null;
  }
  let organizationName = "";
  if (!isBill) {
    const { data } = await supabase.from("organization").select("name").eq("id", session.organizationId).maybeSingle();
    organizationName = (data?.name as string | undefined) ?? "";
  }
  const needsApproval = threshold !== null && record.total_cents >= threshold;
  const owing = record.total_cents - record.paid_cents;
  const title = isBill
    ? `Bill from ${record.contact_name}${record.reference ? ` #${record.reference}` : ""}`
    : `${invoiceLabel(record.invoice_number)} to ${record.contact_name}`;

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow="Bills and invoices"
          title={title}
          description={record.memo ?? undefined}
          actions={<Badge tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Badge>}
        />
        <PayablesTabs />

        <div className="card mb-5 grid gap-4 p-4 text-[14px] sm:grid-cols-4">
          <div>
            <p className="meta">{isBill ? "Bill date" : "Invoice date"}</p>
            <p className="tabular-nums">{record.document_date}</p>
          </div>
          <div>
            <p className="meta">Due</p>
            <p className="tabular-nums">{record.due_date}</p>
          </div>
          <div>
            <p className="meta">Fund</p>
            <p>{record.fund_id ? (fundLabel.get(record.fund_id) ?? "—") : "Not chosen"}</p>
          </div>
          <div>
            <p className="meta">{isBill ? "Payable account" : "Receivable account"}</p>
            <p>
              {record.control_account_id
                ? (accountLabel.get(record.control_account_id) ?? "—")
                : isBill
                  ? "2000 Accounts payable (default)"
                  : "1100 Accounts receivable (default)"}
            </p>
          </div>
          <div>
            <p className="meta">Total</p>
            <p className="font-semibold tabular-nums">{formatCents(record.total_cents)}</p>
          </div>
          <div>
            <p className="meta">Paid</p>
            <p className="tabular-nums">{formatCents(record.paid_cents)}</p>
          </div>
          <div>
            <p className="meta">Still owing</p>
            <p className="font-semibold tabular-nums">{record.status === "void" ? "—" : formatCents(owing)}</p>
          </div>
          <div>
            <p className="meta">Ledger</p>
            <p>
              {record.journal_entry_id ? (
                <Link href={`/finance/ledger/journal/${record.journal_entry_id}`} className="text-brand-fg underline">
                  Posted entry
                </Link>
              ) : (
                "Not posted"
              )}
              {record.void_entry_id ? (
                <>
                  {" · "}
                  <Link href={`/finance/ledger/journal/${record.void_entry_id}`} className="text-brand-fg underline">
                    Void entry ({record.voided_on})
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>

        {record.status === "draft" ? (
          <div className="mb-5 space-y-3">
            {isBill && needsApproval ? (
              <p className="rounded-(--radius-sm) border border-line bg-surface-soft p-3 text-[13.5px]">
                This bill is at or above the approval threshold of {formatCents(threshold ?? 0)}.{" "}
                {APPROVAL_NOTE[approval?.status ?? "none"] ?? APPROVAL_NOTE.none}
                {approval?.approvalItemId ? (
                  <>
                    {" "}
                    <Link href={`/approvals?tab=mine&item=${approval.approvalItemId}`} className="text-brand-fg underline">
                      See the approval
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            <DraftActions
              kind={kind}
              id={record.id}
              canEdit={canEdit}
              // Posting waits for the bill's own approval; the database refuses it anyway.
              canPost={canPost && !(isBill && needsApproval && approval?.status !== "approved")}
              canRequestApproval={isBill && needsApproval && approval?.status !== "pending" && approval?.status !== "approved"}
            />
          </div>
        ) : null}

        {record.status === "posted" && canPost ? (
          <div className="mb-5 flex flex-wrap justify-end gap-2">
            {record.paid_cents === 0 ? (
              <VoidDialog kind={kind} id={record.id} minDate={record.document_date} defaultDate={today} />
            ) : null}
            <PaymentDialog
              kind={kind}
              documentId={record.id}
              owingCents={owing}
              minDate={record.document_date}
              defaultDate={today < record.document_date ? record.document_date : today}
              bankAccounts={bankAccounts}
            />
          </div>
        ) : null}

        {isBill ? (
          <>
            <h2 className="mb-2 text-[15px] font-semibold">Lines</h2>
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader>Description</TableHeader>
                <TableHeader>Account</TableHeader>
                <TableHeader>Program</TableHeader>
                <TableHeader className="w-36 text-right">Amount</TableHeader>
              </TableHead>
              <tbody>
                {record.lines.map((l) => (
                  <TableRow key={l.line_no}>
                    <TableCell>{l.description ?? "—"}</TableCell>
                    <TableCell>{l.account_id ? (accountLabel.get(l.account_id) ?? "—") : "Not chosen"}</TableCell>
                    <TableCell>{l.program_id ? (programLabel.get(l.program_id) ?? "—") : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(Number(l.amount_cents))}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>GST</TableCell>
                  <TableCell>1200 GST receivable</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(record.gst_cents)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>QST</TableCell>
                  <TableCell>1210 QST receivable</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(record.qst_cents)}</TableCell>
                </TableRow>
              </tbody>
            </DataTable>
            {record.receipt_id ? (
              <p className="mt-2 text-[13px] text-muted">
                Entered from a captured bill in{" "}
                <Link href="/finance/receipts" className="text-brand-fg underline">
                  Receipts
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : (
          <p className="mb-2 text-[13.5px] text-muted">
            Below is the invoice as the customer sees it, in {record.language === "fr" ? "French" : "English"}. Revenue
            accounts: {record.lines.map((l) => (l.account_id ? accountLabel.get(l.account_id) : "not chosen")).join(", ")}.
          </p>
        )}

        {record.payments.length > 0 ? (
          <>
            <h2 className="mt-6 mb-2 text-[15px] font-semibold">Payments</h2>
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader className="w-28">Date</TableHeader>
                <TableHeader>Method</TableHeader>
                <TableHeader>Reference</TableHeader>
                <TableHeader className="w-32 text-right">Amount</TableHeader>
                <TableHeader className="w-40">Status</TableHeader>
              </TableHead>
              <tbody>
                {record.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">{p.paid_on}</TableCell>
                    <TableCell>{PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method}</TableCell>
                    <TableCell>{p.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCents(Number(p.amount_cents))}</TableCell>
                    <TableCell>
                      {p.reversed_on ? (
                        <Badge tone="neutral">Reversed {p.reversed_on}</Badge>
                      ) : canPost && record.status !== "void" ? (
                        <ReversePaymentButton paymentId={p.id} minDate={p.paid_on} defaultDate={today < p.paid_on ? p.paid_on : today} />
                      ) : (
                        <Badge tone="success">Posted</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </DataTable>
          </>
        ) : null}
      </div>

      {!isBill ? (
        <div className="mt-6">
          <div className="no-print mb-2 flex justify-end">
            <PrintButton label={`Print ${INVOICE_WORDS[record.language].invoice.toLowerCase()}`} />
          </div>
          <InvoiceSheet record={record} organizationName={organizationName} />
        </div>
      ) : null}
    </div>
  );
}
