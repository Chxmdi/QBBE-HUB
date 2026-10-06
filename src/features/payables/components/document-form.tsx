"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Choice } from "@/features/ledger/components/entry-form";
import { formatCents, parseMoneyToCents } from "@/features/ledger/money";
import { addDays, type DocumentKind } from "@/features/payables/model";
import { saveDocument } from "@/features/payables/services/payables.commands";
import { useLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

export interface DocumentLineValue {
  accountId: string;
  programId: string;
  description: string;
  amount: string;
}

export interface DocumentFormValue {
  id?: string;
  contactId: string;
  receiptId: string;
  reference: string;
  language: "fr" | "en";
  documentDate: string;
  dueDate: string;
  memo: string;
  fundId: string;
  controlAccountId: string;
  gst: string;
  qst: string;
  lines: DocumentLineValue[];
}

export interface ContactChoice extends Choice {
  language: "fr" | "en";
}

interface Line extends DocumentLineValue {
  key: number;
}

function cents(value: string): number {
  return value.trim() === "" ? 0 : (parseMoneyToCents(value) ?? 0);
}

const TERMS: { days: number; label: MessageKey }[] = [
  { days: 0, label: "finance.payables.form.terms.onReceipt" },
  { days: 15, label: "finance.payables.form.terms.days15" },
  { days: 30, label: "finance.payables.form.terms.days30" },
  { days: 60, label: "finance.payables.form.terms.days60" },
];

/**
 * Drafts a bill or an invoice. Staff save drafts; an admin can also save and
 * post in one step. Totals update as you type; the database recomputes them.
 */
export function DocumentForm({
  kind,
  initial,
  contacts,
  receipts,
  accounts,
  controlAccounts,
  funds,
  programs,
  canPost,
}: {
  kind: DocumentKind;
  initial: DocumentFormValue;
  contacts: ContactChoice[];
  receipts: Choice[];
  accounts: Choice[];
  controlAccounts: Choice[];
  funds: Choice[];
  programs: Choice[];
  canPost: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const formId = useId();
  const isBill = kind === "bill";
  const [value, setValue] = useState(initial);
  const [nextKey, setNextKey] = useState(initial.lines.length + 1);
  const blank = (key: number): Line => ({ key, accountId: "", programId: "", description: "", amount: "" });
  const [lines, setLines] = useState<Line[]>(
    initial.lines.length > 0 ? initial.lines.map((l, i) => ({ ...l, key: i })) : [blank(0)],
  );
  const [saving, setSaving] = useState<null | "draft" | "post">(null);
  const [error, setError] = useState<string | null>(null);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + cents(l.amount), 0), [lines]);
  const total = subtotal + cents(value.gst) + cents(value.qst);

  function set<K extends keyof DocumentFormValue>(key: K, v: DocumentFormValue[K]) {
    setValue((current) => ({ ...current, [key]: v }));
  }
  function update(key: number, patch: Partial<DocumentLineValue>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(post: boolean) {
    setError(null);
    setSaving(post ? "post" : "draft");
    const result = await saveDocument({
      kind,
      id: value.id,
      contactId: value.contactId,
      receiptId: value.receiptId,
      reference: value.reference,
      language: value.language,
      documentDate: value.documentDate,
      dueDate: value.dueDate,
      memo: value.memo,
      fundId: value.fundId,
      controlAccountId: value.controlAccountId,
      gst: value.gst,
      qst: value.qst,
      post,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        programId: l.programId,
        description: l.description,
        amount: l.amount,
      })),
    });
    setSaving(null);
    const base = isBill ? "/finance/payables/bills" : "/finance/payables/invoices";
    if (!result.ok) {
      setError(result.error ?? t("finance.payables.form.couldNotSave"));
      if (result.id) {
        toast(result.error ?? t("finance.payables.form.savedNotPosted"), { tone: "warning" });
        router.push(`${base}/${result.id}`);
        router.refresh();
      }
      return;
    }
    toast(
      post
        ? isBill
          ? t("finance.payables.form.billPosted")
          : t("finance.payables.form.invoicePosted")
        : t("finance.payables.form.draftSaved"),
      { tone: "success" },
    );
    router.push(`${base}/${result.id}`);
    router.refresh();
  }

  return (
    <form
      aria-labelledby={`${formId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      className="space-y-5"
    >
      <h2 id={`${formId}-title`} className="sr-only">
        {isBill ? t("finance.payables.form.bill") : t("finance.payables.form.invoice")}
      </h2>
      <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Label htmlFor={`${formId}-contact`}>
            {isBill ? t("finance.payables.form.vendor") : t("finance.payables.form.customerOrFunder")}
          </Label>
          <Select
            id={`${formId}-contact`}
            value={value.contactId}
            onChange={(e) => {
              const contact = contacts.find((c) => c.id === e.target.value);
              setValue((current) => ({
                ...current,
                contactId: e.target.value,
                language: contact?.language ?? current.language,
              }));
            }}
            required
          >
            <option value="">
              {isBill ? t("finance.payables.form.chooseVendor") : t("finance.payables.form.chooseCustomer")}
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          {contacts.length === 0 ? (
            <FieldHint>{t("finance.payables.form.addContactFirst")}</FieldHint>
          ) : null}
        </div>
        {isBill ? (
          <>
            <div>
              <Label htmlFor={`${formId}-reference`}>{t("finance.payables.form.vendorInvoiceNumber")}</Label>
              <Input
                id={`${formId}-reference`}
                value={value.reference}
                maxLength={100}
                onChange={(e) => set("reference", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`${formId}-receipt`}>{t("finance.payables.form.capturedBill")}</Label>
              <Select id={`${formId}-receipt`} value={value.receiptId} onChange={(e) => set("receiptId", e.target.value)}>
                <option value="">{t("finance.payables.form.none")}</option>
                {receipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor={`${formId}-language`}>{t("finance.payables.form.language")}</Label>
            <Select
              id={`${formId}-language`}
              value={value.language}
              onChange={(e) => set("language", e.target.value as "fr" | "en")}
            >
              <option value="fr">{t("finance.payables.languages.fr")}</option>
              <option value="en">{t("finance.payables.languages.en")}</option>
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor={`${formId}-date`}>
            {isBill ? t("finance.payables.form.billDate") : t("finance.payables.form.invoiceDate")}
          </Label>
          <Input
            id={`${formId}-date`}
            type="date"
            value={value.documentDate}
            onChange={(e) => set("documentDate", e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor={`${formId}-due`}>{t("finance.payables.form.dueDate")}</Label>
          <Input
            id={`${formId}-due`}
            type="date"
            value={value.dueDate}
            min={value.documentDate}
            onChange={(e) => set("dueDate", e.target.value)}
            required
          />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
            {TERMS.map((term) => (
              <button
                key={term.days}
                type="button"
                className="text-brand-fg hover:underline"
                onClick={() => value.documentDate && set("dueDate", addDays(value.documentDate, term.days))}
              >
                {t(term.label)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor={`${formId}-fund`}>{t("finance.payables.form.fund")}</Label>
          <Select id={`${formId}-fund`} value={value.fundId} onChange={(e) => set("fundId", e.target.value)} required>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${formId}-control`}>
            {isBill ? t("finance.payables.form.payableAccount") : t("finance.payables.form.receivableAccount")}
          </Label>
          <Select
            id={`${formId}-control`}
            value={value.controlAccountId}
            onChange={(e) => set("controlAccountId", e.target.value)}
          >
            <option value="">
              {isBill ? t("finance.payables.form.defaultPayable") : t("finance.payables.form.defaultReceivable")}
            </option>
            {controlAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
          {!isBill ? <FieldHint>{t("finance.payables.form.grantsHint")}</FieldHint> : null}
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label htmlFor={`${formId}-memo`}>{t("finance.payables.form.memo")}</Label>
          <Input id={`${formId}-memo`} value={value.memo} maxLength={500} onChange={(e) => set("memo", e.target.value)} />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-[15px] font-semibold">{t("finance.payables.form.lines")}</legend>
        {lines.map((line, index) => {
          const id = `${formId}-l${line.key}`;
          return (
            <div key={line.key} className="card grid gap-3 p-3 md:grid-cols-6" role="group" aria-label={t("finance.payables.form.line", { number: index + 1 })}>
              <div className="md:col-span-2">
                <Label htmlFor={`${id}-description`}>
                  {isBill ? t("finance.payables.form.descriptionOptional") : t("finance.payables.form.description")}
                </Label>
                <Input
                  id={`${id}-description`}
                  value={line.description}
                  maxLength={500}
                  required={!isBill}
                  onChange={(e) => update(line.key, { description: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`${id}-account`}>
                  {isBill ? t("finance.payables.form.expenseOrAssetAccount") : t("finance.payables.form.revenueAccount")}
                </Label>
                <Select
                  id={`${id}-account`}
                  value={line.accountId}
                  onChange={(e) => update(line.key, { accountId: e.target.value })}
                >
                  <option value="">
                    {canPost ? t("finance.payables.form.chooseAccount") : t("finance.payables.form.leaveForFinance")}
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-program`}>{t("finance.payables.form.program")}</Label>
                <Select
                  id={`${id}-program`}
                  value={line.programId}
                  onChange={(e) => update(line.key, { programId: e.target.value })}
                >
                  <option value="">{t("finance.payables.form.none")}</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-amount`}>{t("finance.payables.form.amountBeforeTax")}</Label>
                <div className="flex gap-1">
                  <Input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => update(line.key, { amount: e.target.value })}
                    className="text-right tabular-nums"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                    aria-label={t("finance.payables.form.removeLine", { number: index + 1 })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setLines((current) => [...current, blank(nextKey)]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t("finance.payables.form.addLine")}
        </Button>
      </fieldset>

      <div className="card grid gap-4 p-4 sm:grid-cols-4">
        <div>
          <Label htmlFor={`${formId}-gst`}>{t("finance.payables.form.gst")}</Label>
          <Input
            id={`${formId}-gst`}
            inputMode="decimal"
            value={value.gst}
            onChange={(e) => set("gst", e.target.value)}
            className="text-right tabular-nums"
          />
        </div>
        <div>
          <Label htmlFor={`${formId}-qst`}>{t("finance.payables.form.qst")}</Label>
          <Input
            id={`${formId}-qst`}
            inputMode="decimal"
            value={value.qst}
            onChange={(e) => set("qst", e.target.value)}
            className="text-right tabular-nums"
          />
        </div>
        <dl className="flex gap-6 text-[14px] sm:col-span-2 sm:justify-end" aria-live="polite">
          <div>
            <dt className="text-[12.5px] text-muted">{t("finance.payables.form.beforeTax")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(subtotal, locale)}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-muted">{t("finance.payables.form.total")}</dt>
            <dd className="font-semibold tabular-nums">{formatCents(total, locale)}</dd>
          </div>
        </dl>
        <p className="text-[12.5px] text-muted sm:col-span-4">
          {isBill ? t("finance.payables.form.billTaxHint") : t("finance.payables.form.invoiceTaxHint")}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <p role="alert" className="mr-auto text-[13.5px] text-danger-fg">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant={canPost ? "secondary" : "primary"} loading={saving === "draft"} disabled={saving !== null}>
          {t("finance.payables.form.saveDraft")}
        </Button>
        {canPost ? (
          <Button type="button" loading={saving === "post"} disabled={saving !== null} onClick={() => void submit(true)}>
            {isBill ? t("finance.payables.form.saveAndPostBill") : t("finance.payables.form.saveAndPostInvoice")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
