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
  StartReconciliationForm,
  StatementLineActions,
  type MatchOption,
} from "@/features/banking/components/bank-forms";
import { institutionLabel } from "@/features/banking/labels";
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
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";
import { isCalendarMonth } from "@/lib/schema";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.bank.account.metaTitle") };
}
export const dynamic = "force-dynamic";

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const METHOD_LABEL: Record<"suggested" | "manual" | "created", MessageKey> = {
  suggested: "finance.bank.account.methods.suggested",
  manual: "finance.bank.account.methods.manual",
  created: "finance.bank.account.methods.created",
};

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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.bank.account.eyebrow")} title={t("finance.bank.account.metaTitle")} />
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const accountId = uuidParam(rawId);
  if (!accountId) notFound();
  const account = (await loadBankAccounts(supabase, session.organizationId)).find((a) => a.id === accountId);
  if (!account) notFound();

  const month = isCalendarMonth(query.month ?? "") ? query.month! : todayIn(session.timeZone).slice(0, 7);
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
        eyebrow={t("finance.bank.account.eyebrow")}
        title={`${account.name}${account.account_last4 ? ` ···${account.account_last4}` : ""}`}
        description={t("finance.bank.account.description", {
          institution: institutionLabel(t, account.institution),
          ledger: account.ledger_account
            ? `${account.ledger_account.code} ${account.ledger_account.name}`
            : t("finance.bank.account.theLedger"),
          date: account.reconcile_from,
        })}
        actions={
          <>
            <Link href="/finance/bank" className="text-[13.5px] text-muted underline underline-offset-2">
              {t("finance.bank.account.allAccounts")}
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
            {t("finance.bank.account.importHeading")}
          </h2>
          <ImportStatementForm bankAccountId={account.id} institution={account.institution} />
        </section>
      ) : null}

      <section className="mb-8" aria-labelledby="recs-heading">
        <h2 id="recs-heading" className="mb-3 text-[15px] font-semibold">
          {t("finance.bank.account.recsHeading")}
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
          <p className="text-[13.5px] text-muted">{t("finance.bank.account.noRecs")}</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>{t("finance.bank.account.statement")}</TableHeader>
              <TableHeader className="text-right">{t("finance.bank.account.closingBalance")}</TableHeader>
              <TableHeader>{t("finance.common.status")}</TableHeader>
            </TableHead>
            <tbody>
              {recs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">
                    <Link href={`/finance/bank/reconciliations/${r.id}`} className="underline underline-offset-2">
                      {t("finance.bank.period", { start: r.statement_start, end: r.statement_end })}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(Number(r.closing_balance_cents), locale)}</TableCell>
                  <TableCell>
                    {r.status === "reconciled" ? (
                      <Badge tone="success">{t("finance.bank.reconciled")}</Badge>
                    ) : (
                      <Badge tone="warning">{t("finance.bank.open")}</Badge>
                    )}
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
              {t("finance.bank.account.linesHeading", { month })}
            </h2>
            <p className="meta mt-1">
              {t(lines.length === 1 ? "finance.bank.account.lineCountOne" : "finance.bank.account.lineCountOther", {
                count: lines.length,
                unmatched: unmatchedCount,
              })}{" "}
              <Link className="underline underline-offset-2" href={monthLink(shiftMonth(month, -1))}>
                {t("finance.bank.account.previousMonth")}
              </Link>{" "}
              ·{" "}
              <Link className="underline underline-offset-2" href={monthLink(shiftMonth(month, 1))}>
                {t("finance.bank.account.nextMonth")}
              </Link>{" "}
              ·{" "}
              <Link
                className="underline underline-offset-2"
                href={`/finance/bank/${accountId}?month=${month}${unmatchedOnly ? "" : "&show=unmatched"}`}
              >
                {unmatchedOnly ? t("finance.bank.account.showAll") : t("finance.bank.account.showUnmatched")}
              </Link>
            </p>
          </div>
          {canManage && pairs.length > 0 ? <AcceptSuggestionsButton pairs={pairs} /> : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title={lines.length === 0 ? t("finance.bank.account.emptyNoLines") : t("finance.bank.account.emptyAllMatched")}
            description={lines.length === 0 ? t("finance.bank.account.emptyNoLinesDescription") : undefined}
          />
        ) : (
          <DataTable minWidth="900px">
            <TableHead>
              <TableHeader>{t("finance.common.date")}</TableHeader>
              <TableHeader>{t("finance.common.description")}</TableHeader>
              <TableHeader className="text-right">{t("finance.common.amount")}</TableHeader>
              <TableHeader>{t("finance.bank.account.ledger")}</TableHeader>
              {canManage ? (
                <TableHeader className="text-right">
                  <span className="sr-only">{t("finance.common.actions")}</span>
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
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatSigned(l.amount_cents, locale)}</TableCell>
                    <TableCell>
                      {l.entry_id ? (
                        <span>
                          <Link href={`/finance/ledger/journal/${l.entry_id}`} className="underline underline-offset-2">
                            {t("finance.bank.entryNumber", { number: l.entry_number ?? "" })}
                          </Link>{" "}
                          <Badge tone="success">
                            {l.match_method ? t(METHOD_LABEL[l.match_method]) : t("finance.bank.account.matched")}
                          </Badge>
                        </span>
                      ) : suggestion ? (
                        <span className="text-[13px]">
                          <Badge tone="info">{t("finance.bank.account.suggested")}</Badge> {candidateLabel(suggestion)}
                        </span>
                      ) : (
                        <Badge tone="warning">{t("finance.bank.notMatched")}</Badge>
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
          {t("finance.bank.account.importsHeading")}
        </h2>
        {imports.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.bank.account.noImports")}</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>{t("finance.bank.account.file")}</TableHeader>
              <TableHeader>{t("finance.bank.account.dates")}</TableHeader>
              <TableHeader className="text-right">{t("finance.bank.account.added")}</TableHeader>
              <TableHeader className="text-right">{t("finance.bank.account.alreadyThere")}</TableHeader>
              {canManage ? (
                <TableHeader className="text-right">
                  <span className="sr-only">{t("finance.common.actions")}</span>
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
                    {i.first_date ? t("finance.bank.period", { start: i.first_date, end: String(i.last_date) }) : "—"}
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
