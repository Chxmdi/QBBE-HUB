import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { centsToDecimal, formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { AddReportForm, GrantDialog, ReportControls, type GrantFormValue } from "@/features/gifts/components/grant-forms";
import { grantOptions } from "@/features/gifts/services/gift.options";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.gifts.grant.metaTitle") };
}
export const dynamic = "force-dynamic";

interface GrantDetail extends Omit<GrantFormValue, "amount"> {
  amount_awarded_cents: number;
  funder: { name: string } | null;
  contact: { full_name: string } | null;
  fund: { id: string; code: string; name: string } | null;
  program: { name: string } | null;
  responsible: { full_name: string } | null;
}

interface ReportRow {
  id: string;
  title: string;
  due_on: string;
  submitted_on: string | null;
  last_reminded_at: string | null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-[14px]">{children}</dd>
    </div>
  );
}

export default async function GrantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const grantId = uuidParam(id);
  if (!grantId) notFound();
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.gifts.tabs.gifts")} title={t("finance.gifts.grant.metaTitle")} />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const [{ data }, { data: reportData }, { data: payments }, options] = await Promise.all([
    supabase
      .from("grant_award")
      .select(
        `id, funder_crm_organization_id, funder_contact_id, title, funder_reference, amount_awarded_cents, awarded_on,
         starts_on, ends_on, fund_id, program_id, restrictions, responsible_user_id, status,
         funder:funder_crm_organization_id(name), contact:funder_contact_id(full_name), fund:ledger_fund!grant_award_organization_id_fund_id_fkey(id, code, name),
         program:program_id(name), responsible:responsible_user_id(full_name)`,
      )
      .eq("organization_id", session.organizationId)
      .eq("id", grantId)
      .maybeSingle(),
    supabase
      .from("grant_report")
      .select("id, title, due_on, submitted_on, last_reminded_at")
      .eq("grant_id", grantId)
      .order("due_on"),
    supabase
      .from("gift")
      .select("id, gift_number, received_on, amount_cents, status")
      .eq("grant_id", grantId)
      .order("received_on"),
    canManage ? grantOptions(supabase, session.organizationId, t) : Promise.resolve(null),
  ]);
  const grant = data as unknown as GrantDetail | null;
  if (!grant) notFound();
  const reports = (reportData ?? []) as ReportRow[];
  const paid = (payments ?? []) as { id: string; gift_number: number; received_on: string; amount_cents: number; status: string }[];
  const received = paid.filter((p) => p.status === "recorded").reduce((s, p) => s + Number(p.amount_cents), 0);
  const today = todayIn(session.timeZone);

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.gifts.tabs.grants")}
        title={grant.title}
        description={grant.funder ? t("finance.gifts.grant.fromFunder", { funder: grant.funder.name }) : undefined}
        actions={
          options ? (
            <GrantDialog
              grant={{ ...grant, amount: centsToDecimal(Number(grant.amount_awarded_cents)) }}
              options={options}
            />
          ) : undefined
        }
      />
      <GiftTabs />
      <dl className="mb-8 divide-y divide-line">
        <Row label={t("finance.common.status")}>
          {grant.status === "active" ? t("finance.gifts.grant.active") : <Badge>{t("finance.gifts.grants.closed")}</Badge>}
        </Row>
        <Row label={t("finance.gifts.grant.amountAwarded")}>{formatCents(Number(grant.amount_awarded_cents), locale)}</Row>
        <Row label={t("finance.gifts.grant.receivedSoFar")}>
          {formatCents(received, locale)}{" "}
          <span className="meta">
            {t("finance.gifts.grant.stillToCome", { amount: formatCents(Number(grant.amount_awarded_cents) - received, locale) })}
          </span>
        </Row>
        {grant.funder_reference ? <Row label={t("finance.gifts.grant.funderReference")}>{grant.funder_reference}</Row> : null}
        {grant.contact ? <Row label={t("finance.gifts.grant.funderContact")}>{grant.contact.full_name}</Row> : null}
        <Row label={t("finance.gifts.grant.dates")}>
          {grant.awarded_on ? `${t("finance.gifts.grant.awardedOn", { date: grant.awarded_on })} ` : ""}
          {grant.starts_on || grant.ends_on
            ? t("finance.gifts.grant.runs", { start: grant.starts_on ?? "?", end: grant.ends_on ?? "?" })
            : ""}
        </Row>
        <Row label={t("finance.common.fund")}>{grant.fund ? `${grant.fund.code} · ${grant.fund.name}` : ""}</Row>
        <Row label={t("finance.common.program")}>
          {grant.program?.name ?? <span className="text-muted">{t("finance.gifts.grant.anyProgram")}</span>}
        </Row>
        <Row label={t("finance.gifts.grant.restrictions")}>
          {grant.restrictions ? (
            <span className="whitespace-pre-line">{grant.restrictions}</span>
          ) : (
            <span className="text-muted">{t("finance.gifts.grant.noneRecorded")}</span>
          )}
        </Row>
        <Row label={t("finance.gifts.grant.remindersGoTo")}>{grant.responsible?.full_name ?? t("finance.gifts.grant.ownersAndAdmins")}</Row>
      </dl>

      <section aria-labelledby="grant-reports" className="mb-8">
        <h2 id="grant-reports" className="mb-2 text-[15px] font-semibold">
          {t("finance.gifts.grant.reportsHeading")}
        </h2>
        <p className="mb-3 text-[13px] text-muted">
          {t("finance.gifts.grant.remindersNote")}
        </p>
        {reports.length === 0 ? (
          <p className="mb-3 text-[13.5px] text-muted">{t("finance.gifts.grant.noReports")}</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>{t("finance.gifts.grant.colReport")}</TableHeader>
              <TableHeader>{t("finance.gifts.grant.colDue")}</TableHeader>
              <TableHeader>{t("finance.common.status")}</TableHeader>
              {canManage ? (
                <TableHeader>
                  <span className="sr-only">{t("finance.common.actions")}</span>
                </TableHeader>
              ) : null}
            </TableHead>
            <tbody>
              {reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>{r.due_on}</TableCell>
                  <TableCell>
                    {r.submitted_on ? (
                      <Badge tone="success">{t("finance.gifts.grant.submittedOn", { date: r.submitted_on })}</Badge>
                    ) : r.due_on < today ? (
                      <Badge tone="danger">{t("finance.gifts.grants.overdue")}</Badge>
                    ) : (
                      <Badge>{t("finance.gifts.grant.notSubmitted")}</Badge>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <ReportControls reportId={r.id} submitted={Boolean(r.submitted_on)} today={today} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
        {canManage ? (
          <div className="mt-4">
            <AddReportForm grantId={grant.id} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="grant-payments">
        <h2 id="grant-payments" className="mb-2 text-[15px] font-semibold">
          {t("finance.gifts.grant.paymentsHeading")}
        </h2>
        {paid.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.gifts.grant.noPayments")}</p>
        ) : (
          <ul className="space-y-1 text-[14px]">
            {paid.map((p) => (
              <li key={p.id}>
                <Link href={`/finance/gifts/${p.id}`} className="underline">
                  {t("finance.gifts.list.giftNumber", { number: p.gift_number })}
                </Link>{" "}
                · {p.received_on} · {formatCents(Number(p.amount_cents), locale)}
                {p.status === "voided" ? <Badge tone="danger" className="ml-2">{t("finance.gifts.list.void")}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
