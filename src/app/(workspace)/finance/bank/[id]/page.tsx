import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AcceptSuggestionsButton,
  BankAccountDialog,
  DeleteImportButton,
  ImportStatementForm,
  INSTITUTION_LABEL,
  StartReconciliationForm,
  StatementLineActions,
  type MatchOption,
} from "@/features/banking/components/bank-forms";
import { pickSuggestions } from "@/features/banking/matching";
import {
  SUGGESTION_WINDOW_DAYS,
  candidateLabel,
  formatSigned,
  loadBankAccounts,
  loadCandidates,
  loadCashAccountChoices,
  loadStatementLines,
  monthOf,
  nextDay,
  type ReconciliationRow,
} from "@/features/banking/services/bank.queries";
import { centsToDecimal } from "@/features/finance/money";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { loadEntryChoices } from "@/features/ledger/services/ledger.queries";

export const metadata: Metadata = { title: "Bank account" };
export const dynamic = "force-dynamic";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const METHOD_LABEL = { suggested: "Suggested", manual: "Manual", created: "Created here" } as const;

export default async function BankAccountPage({
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
        <PageHeader eyebrow="Bank" title="Bank account" />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const accountId = uuidParam(rawId);
  if (!accountId) notFound();
  const account = (await loadBankAccounts(supabase, session.organizationId)).find((a) => a.id === accountId);
  if (!account) notFound();

  const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : todayIn(session.timeZone).slice(0, 7);
  const { from, to } = monthOf(`${month}-01`);
  const unmatchedOnly = query.show === "unmatched";

  const [lines, candidates, choices, cashAccounts, { data: recData }, { data: importData }] = await Promise.all([
    loadStatementLines(supabase, accountId, from, to),
    loadCandidates(supabase, accountId, from, to),
    canManage ? loadEntryChoices(supabase, session.organizationId) : Promise.resolve(null),
    canManage ? loadCashAccountChoices(supabase, session.organizationId) : Promise.resolve([]),
    supabase
      .from("bank_reconciliation")
      .select("id, bank_account_id, statement_start, statement_end, opening_balance_cents, closing_balance_cents, status, reconciled_at")
      .eq("bank_account_id", accountId)
      .order("statement_start", { ascending: false }),
    supabase
      .from("bank_import")
      .select("id, file_name, file_format, lines_in_file, lines_added, lines_skipped, first_date, last_date, created_at")
      .eq("bank_account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const recs = (recData ?? []) as ReconciliationRow[];
  const imports = (importData ?? []) as {
    id: string;
    file_name: string;
    file_format: string;
    lines_in_file: number;
    lines_added: number;
    lines_skipped: number;
    first_date: string | null;
    last_date: string | null;
    created_at: string;
  }[];

  const suggestions = pickSuggestions(candidates.filter((c) => c.day_gap <= SUGGESTION_WINDOW_DAYS));
  const optionsByLine = new Map<string, MatchOption[]>();
  for (const c of candidates) {
    const list = optionsByLine.get(c.bank_transaction_id) ?? [];
    list.push({ journalLineId: c.journal_line_id, label: candidateLabel(c) });
    optionsByLine.set(c.bank_transaction_id, list);
  }
  const shown = unmatchedOnly ? lines.filter((l) => !l.journal_line_id) : lines;
  const unmatchedCount = lines.filter((l) => !l.journal_line_id).length;
  const pairs = [...suggestions.values()].map((s) => ({
    transactionId: s.bank_transaction_id,
    journalLineId: s.journal_line_id,
  }));

  // The next statement starts the day after the last one, from its closing balance.
  const latest = recs[0];
  const nextStart = latest ? nextDay(latest.statement_end) : account.reconcile_from;
  const nextEnd = monthOf(nextStart).to;
  const nextOpening = latest ? centsToDecimal(Number(latest.closing_balance_cents)) : "";
  const monthLink = (m: string) => `/finance/bank/${accountId}?month=${m}${unmatchedOnly ? "&show=unmatched" : ""}`;

  return (
    <div>
      <PageHeader
        eyebrow="Bank"
        title={`${account.name}${account.account_last4 ? ` ···${account.account_last4}` : ""}`}
        description={`${INSTITUTION_LABEL[account.institution] ?? account.institution}, reconciled against ${
          account.ledger_account ? `${account.ledger_account.code} ${account.ledger_account.name}` : "the ledger"
        } from ${account.reconcile_from}.`}
        actions={
          <>
            <Link href="/finance/bank" className="text-[13.5px] text-muted underline underline-offset-2">
              All bank accounts
            </Link>
            {canManage && choices ? (
              <BankAccountDialog
                account={account}
                cashAccounts={cashAccounts}
                funds={choices.funds}
                defaultFundId={choices.defaultFundId}
              />
            ) : null}
          </>
        }
      />

      {canManage && account.is_active ? (
        <section className="card mb-6 p-4" aria-labelledby="import-heading">
          <h2 id="import-heading" className="mb-3 text-[15px] font-semibold">
            Import a statement
          </h2>
          <ImportStatementForm bankAccountId={account.id} institution={account.institution} />
        </section>
      ) : null}

      <section className="mb-8" aria-labelledby="recs-heading">
        <h2 id="recs-heading" className="mb-3 text-[15px] font-semibold">
          Reconciliations
        </h2>
        {canManage ? (
          <div className="card mb-3 p-4">
            <StartReconciliationForm
              bankAccountId={account.id}
              defaultStart={nextStart}
              defaultEnd={nextEnd}
              defaultOpening={nextOpening}
            />
          </div>
        ) : null}
        {recs.length === 0 ? (
          <p className="text-[13.5px] text-muted">No statement has been reconciled yet.</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>Statement</TableHeader>
              <TableHeader className="text-right">Closing balance</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableHead>
            <tbody>
              {recs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">
                    <Link href={`/finance/bank/reconciliations/${r.id}`} className="underline underline-offset-2">
                      {r.statement_start} to {r.statement_end}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(Number(r.closing_balance_cents))}</TableCell>
                  <TableCell>
                    {r.status === "reconciled" ? <Badge tone="success">Reconciled</Badge> : <Badge tone="warning">Open</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <section className="mb-8" aria-labelledby="lines-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="lines-heading" className="text-[15px] font-semibold">
              Statement lines, {month}
            </h2>
            <p className="meta mt-1">
              {lines.length} line{lines.length === 1 ? "" : "s"}, {unmatchedCount} not matched.{" "}
              <Link className="underline underline-offset-2" href={monthLink(shiftMonth(month, -1))}>
                Previous month
              </Link>{" "}
              ·{" "}
              <Link className="underline underline-offset-2" href={monthLink(shiftMonth(month, 1))}>
                Next month
              </Link>{" "}
              ·{" "}
              <Link
                className="underline underline-offset-2"
                href={`/finance/bank/${accountId}?month=${month}${unmatchedOnly ? "" : "&show=unmatched"}`}
              >
                {unmatchedOnly ? "Show all lines" : "Show unmatched only"}
              </Link>
            </p>
          </div>
          {canManage && pairs.length > 0 ? <AcceptSuggestionsButton pairs={pairs} /> : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={lines.length === 0 ? "No statement lines this month" : "Every line is matched"}
            description={lines.length === 0 ? "Import the month's statement to see its lines here." : undefined}
          />
        ) : (
          <DataTable minWidth="900px">
            <TableHead>
              <TableHeader>Date</TableHeader>
              <TableHeader>Description</TableHeader>
              <TableHeader className="text-right">Amount</TableHeader>
              <TableHeader>Ledger</TableHeader>
              {canManage ? (
                <TableHeader className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHeader>
              ) : null}
            </TableHead>
            <tbody>
              {shown.map((l) => {
                const suggestion = suggestions.get(l.id);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">{l.posted_on}</TableCell>
                    <TableCell>
                      {l.description}
                      {l.reference ? <span className="meta"> · {l.reference}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatSigned(l.amount_cents)}</TableCell>
                    <TableCell>
                      {l.entry_id ? (
                        <span>
                          <Link href={`/finance/ledger/journal/${l.entry_id}`} className="underline underline-offset-2">
                            Entry {l.entry_number}
                          </Link>{" "}
                          <Badge tone="success">{l.match_method ? METHOD_LABEL[l.match_method] : "Matched"}</Badge>
                        </span>
                      ) : suggestion ? (
                        <span className="text-[13px]">
                          <Badge tone="info">Suggested</Badge> {candidateLabel(suggestion)}
                        </span>
                      ) : (
                        <Badge tone="warning">Not matched</Badge>
                      )}
                    </TableCell>
                    {canManage && choices ? (
                      <TableCell className="text-right">
                        <StatementLineActions
                          transactionId={l.id}
                          description={`${l.posted_on} ${l.description}`}
                          matched={Boolean(l.journal_line_id)}
                          locked={l.locked}
                          suggestion={
                            suggestion
                              ? { journalLineId: suggestion.journal_line_id, label: candidateLabel(suggestion) }
                              : null
                          }
                          options={optionsByLine.get(l.id) ?? []}
                          accounts={choices.accounts.filter((a) => a.id !== account.ledger_account_id)}
                          funds={choices.funds}
                          programs={choices.programs}
                          defaultFundId={account.default_fund_id}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="imports-heading">
        <h2 id="imports-heading" className="mb-3 text-[15px] font-semibold">
          Recent imports
        </h2>
        {imports.length === 0 ? (
          <p className="text-[13.5px] text-muted">Nothing imported yet.</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>File</TableHeader>
              <TableHeader>Dates</TableHeader>
              <TableHeader className="text-right">Added</TableHeader>
              <TableHeader className="text-right">Already there</TableHeader>
              {canManage ? (
                <TableHeader className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHeader>
              ) : null}
            </TableHead>
            <tbody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    {i.file_name} <span className="meta">({i.file_format.toUpperCase()})</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {i.first_date ? `${i.first_date} to ${i.last_date}` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.lines_added}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.lines_skipped}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {i.lines_added > 0 ? <DeleteImportButton importId={i.id} fileName={i.file_name} /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
