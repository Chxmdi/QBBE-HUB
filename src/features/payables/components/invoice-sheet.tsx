"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INVOICE_WORDS, formatCentsIn, invoiceLabel } from "@/features/payables/model";
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
  const w = INVOICE_WORDS[lang];
  const money = (cents: number) => formatCentsIn(lang, cents);
  return (
    <article lang={lang} className="card space-y-6 p-6 text-[14px]" aria-label={w.invoice}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-semibold">{organizationName}</p>
        </div>
        <div className="text-right">
          <p className="text-[22px] font-semibold">{w.invoice}</p>
          {record.status === "draft" ? <p className="text-danger-fg">{w.draft}</p> : null}
          {record.status === "void" ? <p className="text-danger-fg">{w.void}</p> : null}
          <dl className="mt-2 grid grid-cols-[auto_auto] justify-end gap-x-3 text-[13.5px]">
            <dt className="text-muted">{w.number}</dt>
            <dd className="tabular-nums">{invoiceLabel(record.invoice_number)}</dd>
            <dt className="text-muted">{w.date}</dt>
            <dd className="tabular-nums">{record.document_date}</dd>
            <dt className="text-muted">{w.due}</dt>
            <dd className="tabular-nums">{record.due_date}</dd>
          </dl>
        </div>
      </header>
      <section>
        <p className="meta">{w.billTo}</p>
        <p className="font-medium">{record.contact_name}</p>
        {record.contact_address ? <p className="whitespace-pre-line text-muted">{record.contact_address}</p> : null}
      </section>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 font-medium">
              {w.description}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              {w.amount}
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
        <dt>{w.subtotal}</dt>
        <dd className="text-right tabular-nums">{money(record.subtotal_cents)}</dd>
        {record.gst_cents > 0 ? (
          <>
            <dt>{w.gst}</dt>
            <dd className="text-right tabular-nums">{money(record.gst_cents)}</dd>
          </>
        ) : null}
        {record.qst_cents > 0 ? (
          <>
            <dt>{w.qst}</dt>
            <dd className="text-right tabular-nums">{money(record.qst_cents)}</dd>
          </>
        ) : null}
        <dt className="font-semibold">{w.total}</dt>
        <dd className="text-right font-semibold tabular-nums">{money(record.total_cents)}</dd>
        {record.paid_cents > 0 ? (
          <>
            <dt>{w.paid}</dt>
            <dd className="text-right tabular-nums">{money(record.paid_cents)}</dd>
            <dt className="font-semibold">{w.balance}</dt>
            <dd className="text-right font-semibold tabular-nums">{money(record.total_cents - record.paid_cents)}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}
