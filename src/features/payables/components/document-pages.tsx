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
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * What the bill page says about its approval (#143). Posting needs the bill's
 * own request approved while the bill still matches what was sent.
 */
const APPROVAL_NOTE: Record<string, MessageKey> = {
  none: "finance.payables.detail.approvalNotes.none",
  pending: "finance.payables.detail.approvalNotes.pending",
  approved: "finance.payables.detail.approvalNotes.approved",
  rejected: "finance.payables.detail.approvalNotes.rejected",
  withdrawn: "finance.payables.detail.approvalNotes.withdrawn",
  changed: "finance.payables.detail.approvalNotes.changed",
};

const linkButton =
  "inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong";

function paths(kind: DocumentKind) {
  return kind === "bill"
    ? { list: "/finance/payables", base: "/finance/payables/bills" }
    : { list: "/finance/payables/invoices", base: "/finance/payables/invoices" };
}

function referenceLabel(kind: DocumentKind, reference: string | null, draft: string): string {
  if (kind === "invoice") return invoiceLabel(reference === null ? null : Number(reference), draft);
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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
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
  const draft = t("finance.payables.draftNumber");

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.common.title")}
        title={t("finance.payables.heading")}
        description={
          isBill ? t("finance.payables.list.billsDescription") : t("finance.payables.list.invoicesDescription")
        }
        actions={
          <Link href={`${paths(kind).base}/new`} className={linkButton}>
            <Plus className="size-4" aria-hidden />
            {isBill ? t("finance.payables.list.newBill") : t("finance.payables.list.newInvoice")}
          </Link>
        }
      />
      <PayablesTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={t("finance.payables.list.filter")}>
        <div>
          <Label htmlFor="doc-status">{t("finance.payables.list.status")}</Label>
          <Select id="doc-status" name="status" defaultValue={status}>
            <option value="">{t("finance.payables.list.anyStatus")}</option>
            <option value="draft">{t(STATUS_LABEL.draft)}</option>
            <option value="posted">{t(STATUS_LABEL.posted)}</option>
            <option value="paid">{t(STATUS_LABEL.paid)}</option>
            <option value="void">{t(STATUS_LABEL.void)}</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.payables.list.apply")}
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={
            status
              ? t("finance.payables.list.emptyStatus")
              : isBill
                ? t("finance.payables.list.emptyBills")
                : t("finance.payables.list.emptyInvoices")
          }
          description={
            isBill
              ? t("finance.payables.list.emptyBillsDescription")
              : t("finance.payables.list.emptyInvoicesDescription")
          }
        />
      ) : (
        <DataTable minWidth="760px">
          <TableHead>
            <TableHeader className="w-28">{t("finance.payables.list.date")}</TableHeader>
            <TableHeader>{isBill ? t("finance.payables.vendor") : t("finance.payables.customer")}</TableHeader>
            <TableHeader className="w-32">{isBill ? t("finance.payables.vendorNo") : t("finance.payables.invoice")}</TableHeader>
            <TableHeader className="w-28">{t("finance.payables.due")}</TableHeader>
            <TableHeader className="w-24">{t("finance.payables.list.status")}</TableHeader>
            <TableHeader className="w-32 text-right">{t("finance.payables.total")}</TableHeader>
            <TableHeader className="w-32 text-right">{t("finance.payables.list.owing")}</TableHeader>
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
                <TableCell className="tabular-nums">{referenceLabel(kind, r.reference, draft)}</TableCell>
                <TableCell className="tabular-nums">{r.due_date}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL[r.status])}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(r.total_cents, locale)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.status === "posted" ? formatCents(r.total_cents - r.paid_cents, locale) : "—"}
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
  const locale = await getLocale();
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
      .map((r) => ({
        id: r.id,
        label: `${r.document_date} ${r.vendor} ${formatCents(Number(r.total_cents), locale)}`,
      })),
    accounts: choices.accounts.filter((a) => lineTypes.includes(a.accountType)),
    controlAccounts: choices.accounts.filter((a) => a.accountType === controlType),
    funds: choices.funds,
    programs: choices.programs,
  };
}

export async function NewDocumentPage({ kind }: { kind: DocumentKind }) {
  const props = await editorProps(kind, null);
  const t = await getT();
  return (
    <div>
      <PageHeader
        eyebrow={t("finance.payables.editor.eyebrow")}
        title={kind === "bill" ? t("finance.payables.list.newBill") : t("finance.payables.list.newInvoice")}
        description={
          kind === "bill"
            ? t("finance.payables.editor.newBillDescription")
            : t("finance.payables.editor.newInvoiceDescription")
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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const record = await loadDocument(supabase, kind, id);
  if (!record) notFound();
  const isBill = kind === "bill";
  const canEdit = record.status === "draft" && (record.created_by === session.userId || canPost);
  const today = todayIn(session.timeZone);
  const money = (cents: number) => formatCents(cents, locale);

  if (query.edit === "1" && canEdit) {
    const props = await editorProps(kind, record);
    return (
      <div>
        <PageHeader
          eyebrow={t("finance.payables.editor.eyebrow")}
          title={isBill ? t("finance.payables.editor.editDraftBill") : t("finance.payables.editor.editDraftInvoice")}
        />
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
    ? record.reference
      ? t("finance.payables.detail.billTitleWithReference", { vendor: record.contact_name, reference: record.reference })
      : t("finance.payables.detail.billTitle", { vendor: record.contact_name })
    : t("finance.payables.detail.invoiceTitle", {
        number: invoiceLabel(record.invoice_number, t("finance.payables.draftNumber")),
        customer: record.contact_name,
      });

  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={t("finance.payables.detail.eyebrow")}
          title={title}
          description={record.memo ?? undefined}
          actions={<Badge tone={STATUS_TONE[record.status]}>{t(STATUS_LABEL[record.status])}</Badge>}
        />
        <PayablesTabs />

        <div className="card mb-5 grid gap-4 p-4 text-[14px] sm:grid-cols-4">
          <div>
            <p className="meta">{isBill ? t("finance.payables.detail.billDate") : t("finance.payables.detail.invoiceDate")}</p>
            <p className="tabular-nums">{record.document_date}</p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.due")}</p>
            <p className="tabular-nums">{record.due_date}</p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.fund")}</p>
            <p>{record.fund_id ? (fundLabel.get(record.fund_id) ?? "—") : t("finance.payables.detail.notChosen")}</p>
          </div>
          <div>
            <p className="meta">
              {isBill ? t("finance.payables.detail.payableAccount") : t("finance.payables.detail.receivableAccount")}
            </p>
            <p>
              {record.control_account_id
                ? (accountLabel.get(record.control_account_id) ?? "—")
                : isBill
                  ? t("finance.payables.form.defaultPayable")
                  : t("finance.payables.form.defaultReceivable")}
            </p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.total")}</p>
            <p className="font-semibold tabular-nums">{money(record.total_cents)}</p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.paid")}</p>
            <p className="tabular-nums">{money(record.paid_cents)}</p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.stillOwing")}</p>
            <p className="font-semibold tabular-nums">{record.status === "void" ? "—" : money(owing)}</p>
          </div>
          <div>
            <p className="meta">{t("finance.payables.detail.ledger")}</p>
            <p>
              {record.journal_entry_id ? (
                <Link href={`/finance/ledger/journal/${record.journal_entry_id}`} className="text-brand-fg underline">
                  {t("finance.payables.detail.postedEntry")}
                </Link>
              ) : (
                t("finance.payables.detail.notPosted")
              )}
              {record.void_entry_id ? (
                <>
                  {" · "}
                  <Link href={`/finance/ledger/journal/${record.void_entry_id}`} className="text-brand-fg underline">
                    {t("finance.payables.detail.voidEntry", { date: record.voided_on ?? "" })}
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
                {t("finance.payables.detail.thresholdNotice", { amount: money(threshold ?? 0) })}{" "}
                {t(APPROVAL_NOTE[approval?.status ?? "none"] ?? APPROVAL_NOTE.none)}
                {approval?.approvalItemId ? (
                  <>
                    {" "}
                    <Link href={`/approvals?tab=mine&item=${approval.approvalItemId}`} className="text-brand-fg underline">
                      {t("finance.payables.detail.seeApproval")}
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
            <h2 className="mb-2 text-[15px] font-semibold">{t("finance.payables.detail.lines")}</h2>
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader>{t("finance.payables.detail.description")}</TableHeader>
                <TableHeader>{t("finance.payables.detail.account")}</TableHeader>
                <TableHeader>{t("finance.payables.detail.program")}</TableHeader>
                <TableHeader className="w-36 text-right">{t("finance.payables.detail.amount")}</TableHeader>
              </TableHead>
              <tbody>
                {record.lines.map((l) => (
                  <TableRow key={l.line_no}>
                    <TableCell>{l.description ?? "—"}</TableCell>
                    <TableCell>
                      {l.account_id ? (accountLabel.get(l.account_id) ?? "—") : t("finance.payables.detail.notChosen")}
                    </TableCell>
                    <TableCell>{l.program_id ? (programLabel.get(l.program_id) ?? "—") : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(l.amount_cents))}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>{t("finance.payables.detail.gst")}</TableCell>
                  <TableCell>{t("finance.payables.detail.gstAccount")}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right tabular-nums">{money(record.gst_cents)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t("finance.payables.detail.qst")}</TableCell>
                  <TableCell>{t("finance.payables.detail.qstAccount")}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="text-right tabular-nums">{money(record.qst_cents)}</TableCell>
                </TableRow>
              </tbody>
            </DataTable>
            {record.receipt_id ? (
              <p className="mt-2 text-[13px] text-muted">
                {t("finance.payables.detail.enteredFromReceiptBefore")}{" "}
                <Link href="/finance/receipts" className="text-brand-fg underline">
                  {t("finance.payables.detail.receiptsLink")}
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : (
          <p className="mb-2 text-[13.5px] text-muted">
            {t(
              record.language === "fr"
                ? "finance.payables.detail.invoicePreviewFr"
                : "finance.payables.detail.invoicePreviewEn",
              {
                accounts: record.lines
                  .map((l) =>
                    l.account_id ? accountLabel.get(l.account_id) : t("finance.payables.detail.accountNotChosen"),
                  )
                  .join(", "),
              },
            )}
          </p>
        )}

        {record.payments.length > 0 ? (
          <>
            <h2 className="mt-6 mb-2 text-[15px] font-semibold">{t("finance.payables.detail.payments")}</h2>
            <DataTable minWidth="640px">
              <TableHead>
                <TableHeader className="w-28">{t("finance.payables.detail.date")}</TableHeader>
                <TableHeader>{t("finance.payables.detail.method")}</TableHeader>
                <TableHeader>{t("finance.payables.detail.reference")}</TableHeader>
                <TableHeader className="w-32 text-right">{t("finance.payables.detail.amount")}</TableHeader>
                <TableHeader className="w-40">{t("finance.payables.detail.status")}</TableHeader>
              </TableHead>
              <tbody>
                {record.payments.map((p) => {
                  const methodKey = PAYMENT_METHOD_LABEL[p.method as PaymentMethod] as MessageKey | undefined;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums">{p.paid_on}</TableCell>
                      <TableCell>{methodKey ? t(methodKey) : p.method}</TableCell>
                      <TableCell>{p.reference ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(Number(p.amount_cents))}</TableCell>
                      <TableCell>
                        {p.reversed_on ? (
                          <Badge tone="neutral">{t("finance.payables.detail.reversedOn", { date: p.reversed_on })}</Badge>
                        ) : canPost && record.status !== "void" ? (
                          <ReversePaymentButton
                            paymentId={p.id}
                            minDate={p.paid_on}
                            defaultDate={today < p.paid_on ? p.paid_on : today}
                          />
                        ) : (
                          <Badge tone="success">{t("finance.payables.detail.posted")}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        ) : null}
      </div>

      {!isBill ? (
        <div className="mt-6">
          <div className="no-print mb-2 flex justify-end">
            <PrintButton
              label={t("finance.payables.detail.printDocument", {
                document: t("finance.payables.invoiceSheet.invoice").toLowerCase(),
              })}
            />
          </div>
          <InvoiceSheet record={record} organizationName={organizationName} />
        </div>
      ) : null}
    </div>
  );
}
