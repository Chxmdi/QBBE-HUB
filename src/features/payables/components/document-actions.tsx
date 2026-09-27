"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Choice } from "@/features/ledger/components/entry-form";
import { centsToDecimal, formatCents } from "@/features/ledger/money";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type DocumentKind } from "@/features/payables/model";
import {
  deleteDraft,
  postDocument,
  recordPayment,
  requestBillApproval,
  reversePayment,
  voidDocument,
} from "@/features/payables/services/payables.commands";
import { useLocale, useT } from "@/lib/i18n/client";

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[13px] text-danger-fg">
      {error}
    </p>
  ) : null;
}

const base = (kind: DocumentKind) => (kind === "bill" ? "/finance/payables/bills" : "/finance/payables/invoices");
const listPath = (kind: DocumentKind) => (kind === "bill" ? "/finance/payables" : "/finance/payables/invoices");

/** Edit, delete, send for approval or post a draft. */
export function DraftActions({
  kind,
  id,
  canEdit,
  canPost,
  canRequestApproval,
}: {
  kind: DocumentKind;
  id: string;
  canEdit: boolean;
  canPost: boolean;
  canRequestApproval: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState<null | "post" | "delete" | "approval">(null);
  const [error, setError] = useState<string | null>(null);
  const isBill = kind === "bill";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit ? (
          <>
            <Link
              href={`${base(kind)}/${id}?edit=1`}
              className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
            >
              {t("finance.payables.actions.editDraft")}
            </Link>
            <Button
              variant="danger"
              loading={pending === "delete"}
              disabled={pending !== null}
              onClick={async () => {
                const question = isBill
                  ? t("finance.payables.actions.confirmDeleteBill")
                  : t("finance.payables.actions.confirmDeleteInvoice");
                if (!window.confirm(question)) return;
                setPending("delete");
                setError(null);
                const result = await deleteDraft({ kind, id });
                setPending(null);
                if (!result.ok) {
                  setError(result.error ?? t("finance.payables.actions.couldNotDelete"));
                  return;
                }
                toast(t("finance.payables.actions.draftDeleted"), { tone: "success" });
                router.push(listPath(kind));
                router.refresh();
              }}
            >
              {t("finance.payables.actions.deleteDraft")}
            </Button>
          </>
        ) : null}
        {canRequestApproval ? (
          <Button
            variant="secondary"
            loading={pending === "approval"}
            disabled={pending !== null}
            onClick={async () => {
              setPending("approval");
              setError(null);
              const result = await requestBillApproval(id);
              setPending(null);
              if (!result.ok) {
                setError(result.error ?? t("finance.payables.actions.couldNotSendForApproval"));
                return;
              }
              toast(t("finance.payables.actions.sentForApproval"), { tone: "success" });
              router.refresh();
            }}
          >
            {t("finance.payables.actions.sendForApproval")}
          </Button>
        ) : null}
        {canPost ? (
          <Button
            loading={pending === "post"}
            disabled={pending !== null}
            onClick={async () => {
              const question = isBill
                ? t("finance.payables.actions.confirmPostBill")
                : t("finance.payables.actions.confirmPostInvoice");
              if (!window.confirm(question)) return;
              setPending("post");
              setError(null);
              const result = await postDocument({ kind, id });
              setPending(null);
              if (!result.ok) {
                setError(result.error ?? t("finance.payables.actions.couldNotPost"));
                return;
              }
              toast(
                isBill ? t("finance.payables.actions.billPosted") : t("finance.payables.actions.invoicePosted"),
                { tone: "success" },
              );
              router.refresh();
            }}
          >
            {isBill ? t("finance.payables.actions.postBill") : t("finance.payables.actions.postInvoice")}
          </Button>
        ) : null}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/** Records a payment made (bill) or received (invoice). */
export function PaymentDialog({
  kind,
  documentId,
  owingCents,
  minDate,
  defaultDate,
  bankAccounts,
}: {
  kind: DocumentKind;
  documentId: string;
  owingCents: number;
  minDate: string;
  defaultDate: string;
  bankAccounts: Choice[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title =
    kind === "bill" ? t("finance.payables.actions.recordPayment") : t("finance.payables.actions.recordPaymentReceived");

  return (
    <>
      <Button onClick={() => setOpen(true)}>{title}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            const result = await recordPayment({
              kind,
              documentId,
              paidOn: String(form.get("paidOn") ?? ""),
              amount: String(form.get("amount") ?? ""),
              bankAccountId: String(form.get("bankAccountId") ?? ""),
              method: String(form.get("method") ?? ""),
              reference: String(form.get("reference") ?? ""),
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? t("finance.payables.actions.couldNotRecordPayment"));
              return;
            }
            toast(t("finance.payables.actions.paymentRecorded"), { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            {t("finance.payables.actions.stillOwingLabel")}{" "}
            <strong className="tabular-nums text-ink">{formatCents(owingCents, locale)}</strong>.{" "}
            {t("finance.payables.actions.paymentNote")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="payment-date">{t("finance.payables.actions.date")}</Label>
              <Input id="payment-date" name="paidOn" type="date" defaultValue={defaultDate} min={minDate} required />
            </div>
            <div>
              <Label htmlFor="payment-amount">{t("finance.payables.actions.amount")}</Label>
              <Input
                id="payment-amount"
                name="amount"
                inputMode="decimal"
                defaultValue={centsToDecimal(owingCents)}
                className="text-right tabular-nums"
                required
              />
            </div>
            <div>
              <Label htmlFor="payment-bank">
                {kind === "bill" ? t("finance.payables.actions.paidFrom") : t("finance.payables.actions.depositedTo")}
              </Label>
              <Select id="payment-bank" name="bankAccountId" defaultValue={bankAccounts[0]?.id} required>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payment-method">{t("finance.payables.actions.method")}</Label>
              <Select id="payment-method" name="method" defaultValue="eft">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(PAYMENT_METHOD_LABEL[m])}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="payment-reference">{t("finance.payables.actions.referenceOptional")}</Label>
            <Input
              id="payment-reference"
              name="reference"
              maxLength={100}
              placeholder={t("finance.payables.actions.referencePlaceholder")}
            />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.payables.actions.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("finance.payables.actions.submitPayment")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Voids a posted bill or invoice with a reversing entry. */
export function VoidDialog({
  kind,
  id,
  minDate,
  defaultDate,
}: {
  kind: DocumentKind;
  id: string;
  minDate: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBill = kind === "bill";
  const voidLabel = isBill ? t("finance.payables.actions.voidBill") : t("finance.payables.actions.voidInvoice");

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {voidLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={isBill ? t("finance.payables.actions.voidBillTitle") : t("finance.payables.actions.voidInvoiceTitle")}
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            const result = await voidDocument({
              kind,
              id,
              date: String(form.get("date") ?? ""),
              reason: String(form.get("reason") ?? ""),
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? t("finance.payables.actions.couldNotVoid"));
              return;
            }
            toast(isBill ? t("finance.payables.actions.billVoided") : t("finance.payables.actions.invoiceVoided"), {
              tone: "success",
            });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            {isBill ? t("finance.payables.actions.voidBillNote") : t("finance.payables.actions.voidInvoiceNote")}
          </p>
          <div>
            <Label htmlFor="void-date">{t("finance.payables.actions.voidDate")}</Label>
            <Input id="void-date" name="date" type="date" defaultValue={defaultDate} min={minDate} required />
            <FieldHint>{t("finance.payables.actions.openPeriodHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor="void-reason">{t("finance.payables.actions.reason")}</Label>
            <Input id="void-reason" name="reason" maxLength={400} required />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.payables.actions.cancel")}
            </Button>
            <Button type="submit" variant="danger" loading={saving}>
              {voidLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Reverses one payment (a mistake or a returned cheque). */
export function ReversePaymentButton({
  paymentId,
  minDate,
  defaultDate,
}: {
  paymentId: string;
  minDate: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("finance.payables.actions.reverse")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("finance.payables.actions.reverseTitle")}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            const result = await reversePayment({
              paymentId,
              date: String(form.get("date") ?? ""),
              reason: String(form.get("reason") ?? ""),
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? t("finance.payables.actions.couldNotReverse"));
              return;
            }
            toast(t("finance.payables.actions.paymentReversed"), { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">{t("finance.payables.actions.reverseNote")}</p>
          <div>
            <Label htmlFor="reverse-payment-date">{t("finance.payables.actions.reversalDate")}</Label>
            <Input id="reverse-payment-date" name="date" type="date" defaultValue={defaultDate} min={minDate} required />
          </div>
          <div>
            <Label htmlFor="reverse-payment-reason">{t("finance.payables.actions.reasonOptional")}</Label>
            <Input id="reverse-payment-reason" name="reason" maxLength={400} />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.payables.actions.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("finance.payables.actions.reversePayment")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
