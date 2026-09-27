import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupApprovalChain, sourceHasApprovals, type ApprovalChainRow } from "@/features/ledger/approval-chain";
import { ApprovalChainSection } from "@/features/ledger/components/approval-chain";
import { DraftActions, ReverseEntryButton } from "@/features/ledger/components/entry-actions";
import { EntryForm } from "@/features/ledger/components/entry-form";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ENTRY_KIND_LABEL, centsToDecimal, formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { loadEntryChoices } from "@/features/ledger/services/ledger.queries";

export const metadata: Metadata = { title: "Journal entry" };
export const dynamic = "force-dynamic";

interface Line {
  id: string;
  line_no: number;
  account_id: string;
  fund_id: string;
  program_id: string | null;
  project_id: string | null;
  description: string | null;
  debit_cents: number;
  credit_cents: number;
  account: { code: string; name: string } | null;
  fund: { code: string } | null;
  program: { name: string } | null;
  project: { name: string } | null;
}

interface Entry {
  id: string;
  entry_number: number | null;
  entry_date: string;
  memo: string;
  kind: "standard" | "opening" | "reversal" | "closing";
  status: "draft" | "posted";
  reverses_entry_id: string | null;
  source_type: string | null;
  source_id: string | null;
  posted_at: string | null;
  poster: { full_name: string } | null;
  creator: { full_name: string } | null;
}

const TRAIL_LABEL: Record<string, string> = {
  draft_saved: "Draft saved",
  entry_posted: "Posted",
  entry_reversed: "Reversed",
  fiscal_year_closed: "Posted as the year-end closing entry",
  fiscal_year_reopened: "Posted as the reopening entry",
};

export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const { id: rawId } = await params;
  const query = await searchParams;
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Ledger" title="Journal entry" />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const id = uuidParam(rawId);
  if (!id) notFound();

  const [
    { data: entryData },
    { data: lineData },
    { data: reversals },
    { data: trailData },
    { data: approvalData },
  ] = await Promise.all([
    supabase
      .from("journal_entry")
      .select(
        "id, entry_number, entry_date, memo, kind, status, reverses_entry_id, source_type, source_id, posted_at, poster:posted_by(full_name), creator:created_by(full_name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("journal_line")
      .select(
        "id, line_no, account_id, fund_id, program_id, project_id, description, debit_cents, credit_cents, account:ledger_account(code, name), fund:ledger_fund(code), program:program_id(name), project:project_id(name)",
      )
      .eq("entry_id", id)
      .order("line_no"),
    supabase.from("journal_entry").select("id, entry_number").eq("reverses_entry_id", id),
    supabase.rpc("ledger_entry_trail", { p_entry: id }),
    supabase.rpc("ledger_entry_approvals", { p_entry: id }),
  ]);
  const approvals = groupApprovalChain((approvalData ?? []) as ApprovalChainRow[]);
  const trail = (trailData ?? []) as { occurred_at: string; action: string; actor_name: string }[];
  const entry = entryData as unknown as Entry | null;
  if (!entry) notFound();
  const lines = (lineData ?? []) as unknown as Line[];
  const reversal = ((reversals ?? []) as { id: string; entry_number: number | null }[])[0];
  const debits = lines.reduce((s, l) => s + Number(l.debit_cents), 0);
  const credits = lines.reduce((s, l) => s + Number(l.credit_cents), 0);
  const title = entry.entry_number ? `Entry ${entry.entry_number}` : "Draft entry";

  if (entry.status === "draft" && canManage && query.edit === "1") {
    const choices = await loadEntryChoices(supabase, session.organizationId);
    return (
      <div>
        <PageHeader eyebrow="Ledger" title="Edit draft entry" description={entry.memo} />
        <LedgerTabs />
        <EntryForm
          initial={{
            entryId: entry.id,
            entryDate: entry.entry_date,
            memo: entry.memo,
            kind: entry.kind === "opening" ? "opening" : "standard",
            lines: lines.map((l) => ({
              accountId: l.account_id,
              fundId: l.fund_id,
              programId: l.program_id ?? "",
              projectId: l.project_id ?? "",
              description: l.description ?? "",
              debit: l.debit_cents ? centsToDecimal(Number(l.debit_cents)) : "",
              credit: l.credit_cents ? centsToDecimal(Number(l.credit_cents)) : "",
            })),
          }}
          {...choices}
        />
      </div>
    );
  }

  const today = todayIn(session.timeZone);
  return (
    <div>
      <PageHeader
        eyebrow="Ledger"
        title={title}
        description={entry.memo}
        actions={
          canManage ? (
            entry.status === "draft" ? (
              <DraftActions entryId={entry.id} />
            ) : entry.kind !== "reversal" && entry.kind !== "closing" && !reversal && entry.entry_number ? (
              <ReverseEntryButton
                entryId={entry.id}
                entryNumber={entry.entry_number}
                defaultDate={today > entry.entry_date ? today : entry.entry_date}
                minDate={entry.entry_date}
              />
            ) : undefined
          ) : undefined
        }
      />
      <LedgerTabs />
      <dl className="card mb-4 grid gap-4 p-4 text-[13.5px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Date</dt>
          <dd className="font-medium tabular-nums">{entry.entry_date}</dd>
        </div>
        <div>
          <dt className="text-muted">Status</dt>
          <dd>
            {entry.status === "posted" ? <Badge tone="success">Posted</Badge> : <Badge tone="warning">Draft</Badge>}{" "}
            <span className="text-muted">{ENTRY_KIND_LABEL[entry.kind]}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{entry.status === "posted" ? "Posted by" : "Created by"}</dt>
          <dd>
            {(entry.status === "posted" ? entry.poster?.full_name : entry.creator?.full_name) || "—"}
            {entry.posted_at ? <span className="meta block">{entry.posted_at.slice(0, 16).replace("T", " ")} UTC</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Related</dt>
          <dd>
            {entry.reverses_entry_id ? (
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${entry.reverses_entry_id}`}>
                Reverses the original entry
              </Link>
            ) : reversal ? (
              <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${reversal.id}`}>
                Reversed by entry {reversal.entry_number}
              </Link>
            ) : entry.source_type === "finance_receipt" && entry.source_id ? (
              <a
                className="text-brand-fg hover:underline"
                href={`/api/finance/ledger/receipts/${entry.source_id}/file`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the receipt
              </a>
            ) : entry.source_type ? (
              <span>From {entry.source_type.replace(/_/g, " ")}</span>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <DataTable minWidth="760px">
        <TableHead>
          <TableHeader>Account</TableHeader>
          <TableHeader>Fund</TableHeader>
          <TableHeader>Program / project</TableHeader>
          <TableHeader className="text-right">Debit</TableHeader>
          <TableHeader className="text-right">Credit</TableHeader>
        </TableHead>
        <tbody>
          {lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <span className="font-mono tabular-nums">{l.account?.code}</span> {l.account?.name}
                {l.description ? <p className="meta">{l.description}</p> : null}
              </TableCell>
              <TableCell className="font-mono">{l.fund?.code}</TableCell>
              <TableCell className="text-[13px]">
                {[l.program?.name, l.project?.name].filter(Boolean).join(" / ") || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {l.debit_cents ? formatCents(Number(l.debit_cents)) : ""}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {l.credit_cents ? formatCents(Number(l.credit_cents)) : ""}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>Total</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(debits)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(credits)}</TableCell>
          </TableRow>
        </tbody>
      </DataTable>

      {approvals.length > 0 || sourceHasApprovals(entry.source_type) ? (
        <ApprovalChainSection
          chains={approvals}
          sourceLabel={entry.source_type === "finance_payment" ? "payment" : "bill"}
        />
      ) : null}

      <section className="mt-6" aria-labelledby="trail-heading">
        <h2 id="trail-heading" className="mb-2 text-base font-semibold">
          Trail
        </h2>
        {trail.length === 0 ? (
          <p className="text-[13.5px] text-muted">No recorded steps.</p>
        ) : (
          <ol className="card divide-y divide-line text-[13.5px]">
            {trail.map((t, i) => (
              <li key={`${t.occurred_at}-${i}`} className="flex flex-wrap justify-between gap-3 px-4 py-2">
                <span>
                  {TRAIL_LABEL[t.action] ?? t.action.replace(/_/g, " ")} by {t.actor_name}
                </span>
                <span className="tabular-nums text-muted">{t.occurred_at.slice(0, 16).replace("T", " ")} UTC</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
