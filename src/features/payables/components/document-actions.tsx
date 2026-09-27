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
  const [pending, setPending] = useState<null | "post" | "delete" | "approval">(null);
  const [error, setError] = useState<string | null>(null);
  const noun = kind === "bill" ? "bill" : "invoice";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit ? (
          <>
            <Link
              href={`${base(kind)}/${id}?edit=1`}
              className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
            >
              Edit draft
            </Link>
            <Button
              variant="danger"
              loading={pending === "delete"}
              disabled={pending !== null}
              onClick={async () => {
                if (!window.confirm(`Delete this draft ${noun}? Nothing has been posted, so nothing else changes.`)) return;
                setPending("delete");
                setError(null);
                const result = await deleteDraft({ kind, id });
                setPending(null);
                if (!result.ok) {
                  setError(result.error ?? "Could not delete the draft.");
                  return;
                }
                toast("Draft deleted.", { tone: "success" });
                router.push(listPath(kind));
                router.refresh();
              }}
            >
              Delete draft
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
                setError(result.error ?? "Could not send the bill for approval.");
                return;
              }
              toast("Sent for approval.", { tone: "success" });
              router.refresh();
            }}
          >
            Send for approval
          </Button>
        ) : null}
        {canPost ? (
          <Button
            loading={pending === "post"}
            disabled={pending !== null}
            onClick={async () => {
              if (!window.confirm(`Post this ${noun} to the ledger? Once posted it can only be voided, not changed.`)) return;
              setPending("post");
              setError(null);
              const result = await postDocument({ kind, id });
              setPending(null);
              if (!result.ok) {
                setError(result.error ?? "Could not post.");
                return;
              }
              toast(kind === "bill" ? "Bill posted." : "Invoice posted.", { tone: "success" });
              router.refresh();
            }}
          >
            Post {noun}
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = kind === "bill" ? "Record a payment" : "Record a payment received";

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
              setError(result.error ?? "Could not record the payment.");
              return;
            }
            toast("Payment recorded and posted.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            Still owing: <strong className="tabular-nums text-ink">{formatCents(owingCents)}</strong>. The payment
            posts to the ledger at once. It cannot be more than what is owing.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="payment-date">Date</Label>
              <Input id="payment-date" name="paidOn" type="date" defaultValue={defaultDate} min={minDate} required />
            </div>
            <div>
              <Label htmlFor="payment-amount">Amount</Label>
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
              <Label htmlFor="payment-bank">{kind === "bill" ? "Paid from" : "Deposited to"}</Label>
              <Select id="payment-bank" name="bankAccountId" defaultValue={bankAccounts[0]?.id} required>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payment-method">Method</Label>
              <Select id="payment-method" name="method" defaultValue="eft">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="payment-reference">Reference (optional)</Label>
            <Input id="payment-reference" name="reference" maxLength={100} placeholder="Cheque number or transfer ID" />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Record payment
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noun = kind === "bill" ? "bill" : "invoice";

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Void {noun}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Void this ${noun}`}>
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
              setError(result.error ?? "Could not void it.");
              return;
            }
            toast(`The ${noun} is void.`, { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            This posts a reversing entry that cancels the {noun} in the ledger. The {noun} stays on file, marked void.
            It cannot be undone.
          </p>
          <div>
            <Label htmlFor="void-date">Date of the void</Label>
            <Input id="void-date" name="date" type="date" defaultValue={defaultDate} min={minDate} required />
            <FieldHint>Must be in an open period.</FieldHint>
          </div>
          <div>
            <Label htmlFor="void-reason">Reason</Label>
            <Input id="void-reason" name="reason" maxLength={400} required />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={saving}>
              Void {noun}
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Reverse
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Reverse this payment">
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
              setError(result.error ?? "Could not reverse the payment.");
              return;
            }
            toast("Payment reversed.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            This posts a reversing entry and puts the amount back as owing. Use it for a payment recorded by mistake
            or a returned cheque.
          </p>
          <div>
            <Label htmlFor="reverse-payment-date">Date of the reversal</Label>
            <Input id="reverse-payment-date" name="date" type="date" defaultValue={defaultDate} min={minDate} required />
          </div>
          <div>
            <Label htmlFor="reverse-payment-reason">Reason (optional)</Label>
            <Input id="reverse-payment-reason" name="reason" maxLength={400} />
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Reverse payment
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
