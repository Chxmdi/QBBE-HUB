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

export const metadata: Metadata = { title: "Grant" };
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
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Gifts" title="Grant" />
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
    canManage ? grantOptions(supabase, session.organizationId) : Promise.resolve(null),
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
        eyebrow="Grants"
        title={grant.title}
        description={grant.funder ? `From ${grant.funder.name}` : undefined}
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
        <Row label="Status">{grant.status === "active" ? "Active" : <Badge>Closed</Badge>}</Row>
        <Row label="Amount awarded">{formatCents(Number(grant.amount_awarded_cents))}</Row>
        <Row label="Received so far">
          {formatCents(received)}{" "}
          <span className="meta">({formatCents(Number(grant.amount_awarded_cents) - received)} still to come)</span>
        </Row>
        {grant.funder_reference ? <Row label="Funder's file number">{grant.funder_reference}</Row> : null}
        {grant.contact ? <Row label="Funder contact">{grant.contact.full_name}</Row> : null}
        <Row label="Dates">
          {grant.awarded_on ? `Awarded ${grant.awarded_on}. ` : ""}
          {grant.starts_on || grant.ends_on ? `Runs ${grant.starts_on ?? "?"} to ${grant.ends_on ?? "?"}.` : ""}
        </Row>
        <Row label="Fund">{grant.fund ? `${grant.fund.code} · ${grant.fund.name}` : ""}</Row>
        <Row label="Program">{grant.program?.name ?? <span className="text-muted">Any program</span>}</Row>
        <Row label="Restrictions">
          {grant.restrictions ? <span className="whitespace-pre-line">{grant.restrictions}</span> : <span className="text-muted">None recorded</span>}
        </Row>
        <Row label="Reminders go to">{grant.responsible?.full_name ?? "Owners and admins"}</Row>
      </dl>

      <section aria-labelledby="grant-reports" className="mb-8">
        <h2 id="grant-reports" className="mb-2 text-[15px] font-semibold">
          Reports owed to the funder
        </h2>
        <p className="mb-3 text-[13px] text-muted">
          Reminders go out 14 days before, on the due date, then weekly while a report is overdue.
        </p>
        {reports.length === 0 ? (
          <p className="mb-3 text-[13.5px] text-muted">No reports scheduled.</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>Report</TableHeader>
              <TableHeader>Due</TableHeader>
              <TableHeader>Status</TableHeader>
              {canManage ? (
                <TableHeader>
                  <span className="sr-only">Actions</span>
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
                      <Badge tone="success">Submitted {r.submitted_on}</Badge>
                    ) : r.due_on < today ? (
                      <Badge tone="danger">Overdue</Badge>
                    ) : (
                      <Badge>Not submitted</Badge>
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
          Payments received
        </h2>
        {paid.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            None yet. Record a payment from Gifts, choosing &ldquo;Grant payment&rdquo;.
          </p>
        ) : (
          <ul className="space-y-1 text-[14px]">
            {paid.map((p) => (
              <li key={p.id}>
                <Link href={`/finance/gifts/${p.id}`} className="underline">
                  Gift {p.gift_number}
                </Link>{" "}
                · {p.received_on} · {formatCents(Number(p.amount_cents))}
                {p.status === "voided" ? <Badge tone="danger" className="ml-2">Void</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
