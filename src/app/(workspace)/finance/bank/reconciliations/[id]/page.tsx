import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ReconciliationBalancesForm,
  ReconciliationStatusActions,
} from "@/features/banking/components/bank-forms";
import { formatSigned, loadReconciliationView } from "@/features/banking/services/bank.queries";
import { centsToDecimal } from "@/features/finance/money";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess, uuidParam } from "@/features/ledger/services/ledger.access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bank reconciliation" };
export const dynamic = "force-dynamic";

function Figure({ label, cents, strong, tone }: { label: string; cents: number; strong?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={cn("text-[13.5px]", strong ? "font-semibold" : "text-muted")}>{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong && "font-semibold",
          tone === "ok" && "text-success-fg",
          tone === "bad" && "text-danger-fg",
        )}
      >
        {formatSigned(cents)}
      </dd>
    </div>
  );
}

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const { id: rawId } = await params;
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Bank" title="Reconciliation" />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const id = uuidParam(rawId);
  if (!id) notFound();
  const view = await loadReconciliationView(supabase, session.organizationId, id);
  if (!view) notFound();
  const { rec, account, figures, lines, outstanding } = view;

  const problems: string[] = [];
  if (figures.unmatched_count > 0) {
    problems.push(
      `${figures.unmatched_count} statement line${figures.unmatched_count === 1 ? " is" : "s are"} not matched to the ledger.`,
    );
  }
  if (figures.statement_gap_cents !== 0) {
    problems.push(
      `The statement lines add up to ${formatSigned(figures.statement_lines_cents)}, but the balances say ${formatSigned(
        rec.closing_balance_cents - rec.opening_balance_cents,
      )}. A line is missing or the balances were typed wrong.`,
    );
  }
  if (figures.difference_cents !== 0) {
    problems.push(`The difference is ${formatSigned(figures.difference_cents)}; it must be zero.`);
  }
  const canClose = problems.length === 0;
  const accountLink = `/finance/bank/${account.id}?month=${rec.statement_start.slice(0, 7)}&show=unmatched`;

  return (
    <div>
      <PageHeader
        eyebrow={`Bank · ${account.name}`}
        title={`Reconciliation ${rec.statement_start} to ${rec.statement_end}`}
        description="The statement's closing balance must equal the ledger balance the bank has seen. Outstanding cheques and deposits explain the rest of the ledger balance."
        actions={
          <>
            <Link href={`/finance/bank/${account.id}`} className="text-[13.5px] text-muted underline underline-offset-2">
              Back to {account.name}
            </Link>
            <a
              href={`/api/finance/bank/reconciliations/${rec.id}`}
              className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              Report (CSV)
            </a>
          </>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="figures-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="figures-heading" className="text-[15px] font-semibold">
              Bank and ledger
            </h2>
            {rec.status === "reconciled" ? (
              <Badge tone="success">Reconciled</Badge>
            ) : (
              <Badge tone="warning">Open</Badge>
            )}
          </div>
          <dl className="divide-y divide-line">
            <Figure label="Statement opening balance" cents={rec.opening_balance_cents} />
            <Figure label="Statement lines in the period" cents={figures.statement_lines_cents} />
            <Figure label="Statement closing balance" cents={rec.closing_balance_cents} strong />
            <Figure label="Ledger balance at statement end" cents={figures.ledger_balance_cents} />
            <Figure label="Less outstanding ledger items" cents={figures.outstanding_cents} />
            <Figure label="Cleared ledger balance" cents={figures.cleared_balance_cents} strong />
            <Figure
              label="Difference"
              cents={figures.difference_cents}
              strong
              tone={figures.difference_cents === 0 ? "ok" : "bad"}
            />
          </dl>
        </section>

        <section className="card p-4" aria-labelledby="close-heading">
          <h2 id="close-heading" className="mb-3 text-[15px] font-semibold">
            {rec.status === "reconciled" ? "Reconciled" : "Before it can be marked reconciled"}
          </h2>
          {rec.status === "reconciled" ? (
            <p className="mb-3 text-[13.5px] text-muted">
              Reconciled {rec.reconciled_at?.slice(0, 10)}. Its statement lines and matches are locked; reopen it to
              change them.
            </p>
          ) : canClose ? (
            <p className="mb-3 text-[13.5px] text-success-fg">Everything matches and the difference is zero.</p>
          ) : (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-[13.5px]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {figures.unmatched_count > 0 ? (
                <li>
                  <Link href={accountLink} className="underline underline-offset-2">
                    Match the remaining lines
                  </Link>
                </li>
              ) : null}
            </ul>
          )}
          {canManage ? (
            <div className="space-y-4">
              {rec.status === "open" ? (
                <ReconciliationBalancesForm
                  reconciliationId={rec.id}
                  opening={centsToDecimal(rec.opening_balance_cents)}
                  closing={centsToDecimal(rec.closing_balance_cents)}
                />
              ) : null}
              <ReconciliationStatusActions
                reconciliationId={rec.id}
                status={rec.status}
                canClose={canClose}
                bankAccountId={account.id}
              />
            </div>
          ) : null}
        </section>
      </div>

      <section className="mb-8" aria-labelledby="outstanding-heading">
        <h2 id="outstanding-heading" className="mb-3 text-[15px] font-semibold">
          Outstanding ledger items ({outstanding.length})
        </h2>
        {outstanding.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nothing in the ledger is waiting on the bank.</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>Date</TableHeader>
              <TableHeader>Entry</TableHeader>
              <TableHeader className="text-right">Amount</TableHeader>
            </TableHead>
            <tbody>
              {outstanding.map((o) => (
                <TableRow key={o.journal_line_id}>
                  <TableCell className="tabular-nums">{o.entry_date}</TableCell>
                  <TableCell>
                    <Link href={`/finance/ledger/journal/${o.entry_id}`} className="underline underline-offset-2">
                      Entry {o.entry_number}
                    </Link>{" "}
                    {o.memo}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(o.amount_cents)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="stmt-heading">
        <h2 id="stmt-heading" className="mb-3 text-[15px] font-semibold">
          Statement lines ({lines.length})
        </h2>
        {lines.length === 0 ? (
          <p className="text-[13.5px] text-muted">No statement lines in these dates yet. Import the statement first.</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>Date</TableHeader>
              <TableHeader>Description</TableHeader>
              <TableHeader className="text-right">Amount</TableHeader>
              <TableHeader>Ledger</TableHeader>
            </TableHead>
            <tbody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">{l.posted_on}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(l.amount_cents)}</TableCell>
                  <TableCell>
                    {l.entry_id ? (
                      <Link href={`/finance/ledger/journal/${l.entry_id}`} className="underline underline-offset-2">
                        Entry {l.entry_number}
                      </Link>
                    ) : (
                      <Badge tone="warning">Not matched</Badge>
                    )}
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
