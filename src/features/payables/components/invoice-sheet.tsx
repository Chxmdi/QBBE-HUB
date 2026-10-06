"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCentsIn, invoiceLabel, invoiceTranslator } from "@/features/payables/model";
import type { DocumentRecord } from "@/features/payables/services/payables.queries";

export function PrintButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

/** The invoice as the customer reads it, in the invoice's language. */
export function InvoiceSheet({ record, organizationName }: { record: DocumentRecord; organizationName: string }) {
  const lang = record.language;
  const t = invoiceTranslator(lang);
  const money = (cents: number) => formatCentsIn(lang, cents);
  return (
    <article lang={lang} className="card space-y-6 p-6 text-[14px]" aria-label={t("finance.payables.invoiceSheet.invoice")}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-semibold">{organizationName}</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-semibold">{t("finance.payables.invoiceSheet.invoice")}</p>
          {record.status === "draft" ? <p className="text-danger-fg">{t("finance.payables.invoiceSheet.draft")}</p> : null}
          {record.status === "void" ? <p className="text-danger-fg">{t("finance.payables.invoiceSheet.void")}</p> : null}
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 text-[13.5px]">
            <dt className="text-muted">{t("finance.payables.invoiceSheet.number")}</dt>
            <dd className="tabular-nums">{invoiceLabel(record.invoice_number, t("finance.payables.draftNumber"))}</dd>
            <dt className="text-muted">{t("finance.payables.invoiceSheet.date")}</dt>
            <dd className="tabular-nums">{record.document_date}</dd>
            <dt className="text-muted">{t("finance.payables.invoiceSheet.due")}</dt>
            <dd className="tabular-nums">{record.due_date}</dd>
          </dl>
        </div>
      </header>
      <section>
        <p className="meta">{t("finance.payables.invoiceSheet.billTo")}</p>
        <p className="font-medium">{record.contact_name}</p>
        {record.contact_address ? <p className="whitespace-pre-line text-muted">{record.contact_address}</p> : null}
      </section>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 font-medium">
              {t("finance.payables.invoiceSheet.description")}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {t("finance.payables.invoiceSheet.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {record.lines.map((l) => (
            <tr key={l.line_no} className="border-b border-line/60">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{money(Number(l.amount_cents))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-[14px]">
        <dt>{t("finance.payables.invoiceSheet.subtotal")}</dt>
        <dd className="text-right tabular-nums">{money(record.subtotal_cents)}</dd>
        {record.gst_cents > 0 ? (
          <>
            <dt>{t("finance.payables.invoiceSheet.gst")}</dt>
            <dd className="text-right tabular-nums">{money(record.gst_cents)}</dd>
          </>
        ) : null}
        {record.qst_cents > 0 ? (
          <>
            <dt>{t("finance.payables.invoiceSheet.qst")}</dt>
            <dd className="text-right tabular-nums">{money(record.qst_cents)}</dd>
          </>
        ) : null}
        <dt className="font-semibold">{t("finance.payables.invoiceSheet.total")}</dt>
        <dd className="text-right font-semibold tabular-nums">{money(record.total_cents)}</dd>
        {record.paid_cents > 0 ? (
          <>
            <dt>{t("finance.payables.invoiceSheet.paid")}</dt>
            <dd className="text-right tabular-nums">{money(record.paid_cents)}</dd>
            <dt className="font-semibold">{t("finance.payables.invoiceSheet.balance")}</dt>
            <dd className="text-right font-semibold tabular-nums">{money(record.total_cents - record.paid_cents)}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}
