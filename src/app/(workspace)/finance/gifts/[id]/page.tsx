import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FUND_RESTRICTION_KEY, formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import type { AckLanguage } from "@/features/gifts/acknowledgement";
import { AcknowledgeForm, ResendButton, VoidGiftDialog } from "@/features/gifts/components/gift-actions";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { NotAReceiptNotice } from "@/features/gifts/components/not-a-receipt-notice";
import { GIFT_TYPE_KEY, donorKey, donorName, loadGift } from "@/features/gifts/services/gift.data";
import { intlLocale } from "@/lib/i18n/config";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.gifts.detail.metaTitle") };
}
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

const EMAIL_STATUS: Record<string, { label: MessageKey; tone: "success" | "warning" | "danger" | "neutral" }> = {
  queued: { label: "finance.gifts.detail.emailStatus.queued", tone: "neutral" },
  sent: { label: "finance.gifts.detail.emailStatus.sent", tone: "success" },
  failed: { label: "finance.gifts.detail.emailStatus.failed", tone: "danger" },
  blocked: { label: "finance.gifts.detail.emailStatus.blocked", tone: "warning" },
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
  const [t, locale, format] = await Promise.all([getT(), getLocale(), getFormatters()]);
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.common.title")} title={t("finance.gifts.detail.metaTitle")} />
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
  const name = donorName(gift, t("finance.gifts.unknownDonor"));

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.gifts.tabs.gifts")}
        title={t("finance.gifts.list.giftNumber", { number: gift.gift_number })}
        description={t("finance.gifts.detail.description", { type: t(GIFT_TYPE_KEY[gift.gift_type]), donor: name, date: gift.received_on })}
        actions={canManage && gift.status === "recorded" ? <VoidGiftDialog giftId={gift.id} today={today} /> : undefined}
      />
      <GiftTabs />
      {gift.status === "voided" ? (
        <div role="note" className="mb-6 rounded-(--radius-md) border border-danger/40 bg-danger/5 px-4 py-3 text-[13.5px]">
          <p className="font-medium">{t("finance.gifts.detail.voidHeading")}</p>
          <p className="text-muted">
            {gift.void_reason}
            {gift.void_entry ? ` ${t("finance.gifts.detail.reversedBy", { number: String(gift.void_entry.entry_number) })}` : ""}
          </p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="gift-details">
          <h2 id="gift-details" className="mb-2 text-[15px] font-semibold">
            {t("finance.gifts.detail.details")}
          </h2>
          <dl className="divide-y divide-line">
            <Row label={t("finance.gifts.detail.donor")}>
              {gift.contact ? (
                <Link href="/crm" className="hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}{" "}
              <span className="meta">
                {t(gift.contact ? "finance.gifts.detail.personInRelationships" : "finance.gifts.detail.organizationInRelationships")}
              </span>
            </Row>
            <Row label={t("finance.gifts.detail.kind")}>{t(GIFT_TYPE_KEY[gift.gift_type])}</Row>
            {gift.grant ? (
              <Row label={t("finance.gifts.detail.grant")}>
                <Link href={`/finance/gifts/grants/${gift.grant.id}`} className="hover:underline">
                  {gift.grant.title}
                </Link>
              </Row>
            ) : null}
            {gift.in_kind_description ? <Row label={t("finance.gifts.detail.whatWasGiven")}>{gift.in_kind_description}</Row> : null}
            <Row label={gift.gift_type === "in_kind" ? t("finance.gifts.detail.valueByDonor") : t("finance.common.amount")}>
              {gift.amount_cents === null ? <span className="text-muted">{t("finance.gifts.detail.noDollarValue")}</span> : formatCents(Number(gift.amount_cents), locale)}
            </Row>
            <Row label={t("finance.common.fund")}>
              {gift.fund ? `${gift.fund.code} · ${gift.fund.name} (${t(FUND_RESTRICTION_KEY[gift.fund.restriction])})` : ""}
            </Row>
            <Row label={t("finance.common.program")}>
              {gift.program?.name ?? <span className="text-muted">{t("finance.gifts.detail.noProgramRestriction")}</span>}
            </Row>
            {gift.donor_restriction ? <Row label={t("finance.gifts.detail.donorRestriction")}>{gift.donor_restriction}</Row> : null}
            <Row label={t("finance.gifts.detail.ledgerEntry")}>
              {gift.entry ? (
                <Link href={`/finance/ledger/journal/${gift.entry.id}`} className="hover:underline">
                  {t("finance.gifts.detail.entryNumber", { number: gift.entry.entry_number ?? "" })}
                </Link>
              ) : (
                <span className="text-muted">{t("finance.gifts.detail.notPosted")}</span>
              )}
            </Row>
            {gift.note ? <Row label={t("finance.gifts.detail.internalNote")}>{gift.note}</Row> : null}
          </dl>
        </section>

        <aside aria-labelledby="gift-ack" className="space-y-4">
          <h2 id="gift-ack" className="text-[15px] font-semibold">
            {t("finance.gifts.detail.thankYouLetter")}
          </h2>
          <NotAReceiptNotice />
          {canManage && gift.status === "recorded" ? (
            <AcknowledgeForm target={{ kind: "gift", giftId: gift.id }} defaultEmail={gift.contact?.email ?? null} />
          ) : null}
          <p className="text-[12.5px] text-muted">
            {t("finance.gifts.detail.annualStatementFor")}{" "}
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
          {t("finance.gifts.detail.lettersIssued")}
        </h2>
        {ackRows.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.gifts.detail.noLetters")}</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>{t("finance.gifts.detail.colIssued")}</TableHeader>
              <TableHeader>{t("finance.gifts.detail.colLanguage")}</TableHeader>
              <TableHeader>{t("finance.gifts.detail.colSentBy")}</TableHeader>
              <TableHeader>
                <span className="sr-only">{t("finance.common.actions")}</span>
              </TableHeader>
            </TableHead>
            <tbody>
              {ackRows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {locale === "en"
                      ? new Date(a.created_at).toLocaleString(intlLocale(locale), { timeZone: session.timeZone })
                      : format.dateTime(a.created_at, session.timeZone)}
                    <p className="meta">{a.issuer?.full_name ?? ""}</p>
                  </TableCell>
                  <TableCell>{t(`finance.gifts.languages.${a.language}`)}</TableCell>
                  <TableCell>
                    {a.channel === "print" ? (
                      t("finance.common.print")
                    ) : (
                      <>
                        {a.recipient_email}{" "}
                        {a.email_status ? (
                          <Badge tone={EMAIL_STATUS[a.email_status].tone}>{t(EMAIL_STATUS[a.email_status].label)}</Badge>
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
                        {t("finance.gifts.detail.viewAndPrint")}
                      </a>
                      <a href={`/api/finance/gifts/acknowledgements/${a.id}?download=1`} className="text-[13px] underline">
                        {t("finance.gifts.detail.downloadHtml")}
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
