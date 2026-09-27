import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FUND_RESTRICTION_LABEL, formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { LANGUAGE_LABEL, type AckLanguage } from "@/features/gifts/acknowledgement";
import { AcknowledgeForm, ResendButton, VoidGiftDialog } from "@/features/gifts/components/gift-actions";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { NotAReceiptNotice } from "@/features/gifts/components/not-a-receipt-notice";
import { GIFT_TYPE_LABEL, donorKey, donorName, loadGift } from "@/features/gifts/services/gift.data";

export const metadata: Metadata = { title: "Gift" };
export const dynamic = "force-dynamic";

interface AckRow {
  id: string;
  language: AckLanguage;
  channel: "print" | "email";
  recipient_email: string | null;
  email_status: "queued" | "sent" | "failed" | "blocked" | null;
  email_error: string | null;
  sent_at: string | null;
  created_at: string;
  issuer: { full_name: string } | null;
}

const EMAIL_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  queued: { label: "Sending", tone: "neutral" },
  sent: { label: "Emailed", tone: "success" },
  failed: { label: "Email failed", tone: "danger" },
  blocked: { label: "Not emailed", tone: "warning" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-[14px]">{children}</dd>
    </div>
  );
}

export default async function GiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const giftId = uuidParam(id);
  if (!giftId) notFound();
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Finance" title="Gift" />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const gift = await loadGift(supabase, session.organizationId, giftId);
  if (!gift) notFound();
  const { data: acks } = await supabase
    .from("gift_acknowledgement")
    .select("id, language, channel, recipient_email, email_status, email_error, sent_at, created_at, issuer:created_by(full_name)")
    .eq("gift_id", gift.id)
    .order("created_at", { ascending: false });
  const ackRows = (acks ?? []) as unknown as AckRow[];
  const today = todayIn(session.timeZone);
  const name = donorName(gift);

  return (
    <div>
      <PageHeader
        eyebrow="Gifts"
        title={`Gift ${gift.gift_number}`}
        description={`${GIFT_TYPE_LABEL[gift.gift_type]} from ${name}, received ${gift.received_on}.`}
        actions={canManage && gift.status === "recorded" ? <VoidGiftDialog giftId={gift.id} today={today} /> : undefined}
      />
      <GiftTabs />
      {gift.status === "voided" ? (
        <div role="note" className="mb-6 rounded-(--radius-md) border border-danger/40 bg-danger/5 px-4 py-3 text-[13.5px]">
          <p className="font-medium">This gift is void.</p>
          <p className="text-muted">
            {gift.void_reason}
            {gift.void_entry ? ` Reversed by ledger entry ${gift.void_entry.entry_number}.` : ""}
          </p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="gift-details">
          <h2 id="gift-details" className="mb-2 text-[15px] font-semibold">
            Details
          </h2>
          <dl className="divide-y divide-line">
            <Row label="Donor">
              {gift.contact ? (
                <Link href="/crm" className="hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}{" "}
              <span className="meta">({gift.contact ? "person" : "organization"} in Relationships)</span>
            </Row>
            <Row label="Kind">{GIFT_TYPE_LABEL[gift.gift_type]}</Row>
            {gift.grant ? (
              <Row label="Grant">
                <Link href={`/finance/gifts/grants/${gift.grant.id}`} className="hover:underline">
                  {gift.grant.title}
                </Link>
              </Row>
            ) : null}
            {gift.in_kind_description ? <Row label="What was given">{gift.in_kind_description}</Row> : null}
            <Row label={gift.gift_type === "in_kind" ? "Value stated by the donor" : "Amount"}>
              {gift.amount_cents === null ? <span className="text-muted">No dollar value</span> : formatCents(Number(gift.amount_cents))}
            </Row>
            <Row label="Fund">
              {gift.fund ? `${gift.fund.code} · ${gift.fund.name} (${FUND_RESTRICTION_LABEL[gift.fund.restriction]})` : ""}
            </Row>
            <Row label="Program">{gift.program?.name ?? <span className="text-muted">No program restriction</span>}</Row>
            {gift.donor_restriction ? <Row label="Donor's restriction">{gift.donor_restriction}</Row> : null}
            <Row label="Ledger entry">
              {gift.entry ? (
                <Link href={`/finance/ledger/journal/${gift.entry.id}`} className="hover:underline">
                  Entry {gift.entry.entry_number}
                </Link>
              ) : (
                <span className="text-muted">Not posted (no dollar value)</span>
              )}
            </Row>
            {gift.note ? <Row label="Internal note">{gift.note}</Row> : null}
          </dl>
        </section>

        <aside aria-labelledby="gift-ack" className="space-y-4">
          <h2 id="gift-ack" className="text-[15px] font-semibold">
            Thank-you letter
          </h2>
          <NotAReceiptNotice />
          {canManage && gift.status === "recorded" ? (
            <AcknowledgeForm target={{ kind: "gift", giftId: gift.id }} defaultEmail={gift.contact?.email ?? null} />
          ) : null}
          <p className="text-[12.5px] text-muted">
            Annual statement for this donor:{" "}
            <Link
              href={`/finance/gifts/statement?donor=${donorKey(gift)}&year=${gift.received_on.slice(0, 4)}`}
              className="underline"
            >
              {gift.received_on.slice(0, 4)}
            </Link>
          </p>
        </aside>
      </div>

      <section aria-labelledby="gift-acks" className="mt-8">
        <h2 id="gift-acks" className="mb-2 text-[15px] font-semibold">
          Letters issued
        </h2>
        {ackRows.length === 0 ? (
          <p className="text-[13.5px] text-muted">No thank-you letter has been issued for this gift yet.</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>Issued</TableHeader>
              <TableHeader>Language</TableHeader>
              <TableHeader>Sent by</TableHeader>
              <TableHeader>
                <span className="sr-only">Actions</span>
              </TableHeader>
            </TableHead>
            <tbody>
              {ackRows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {new Date(a.created_at).toLocaleString("en-CA", { timeZone: session.timeZone })}
                    <p className="meta">{a.issuer?.full_name ?? ""}</p>
                  </TableCell>
                  <TableCell>{LANGUAGE_LABEL[a.language]}</TableCell>
                  <TableCell>
                    {a.channel === "print" ? (
                      "Print"
                    ) : (
                      <>
                        {a.recipient_email}{" "}
                        {a.email_status ? (
                          <Badge tone={EMAIL_STATUS[a.email_status].tone}>{EMAIL_STATUS[a.email_status].label}</Badge>
                        ) : null}
                        {a.email_error ? <p className="meta">{a.email_error}</p> : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <a
                        href={`/api/finance/gifts/acknowledgements/${a.id}`}
                        target="_blank"
                        rel="noopener"
                        className="text-[13px] underline"
                      >
                        View and print
                      </a>
                      <a href={`/api/finance/gifts/acknowledgements/${a.id}?download=1`} className="text-[13px] underline">
                        Download HTML
                      </a>
                      {canManage && a.channel === "email" && a.email_status !== "sent" ? <ResendButton ackId={a.id} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
