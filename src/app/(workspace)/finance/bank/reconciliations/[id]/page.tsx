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
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.bank.reconciliation.metaTitle") };
}
export const dynamic = "force-dynamic";

function Figure({
  label,
  cents,
  locale,
  strong,
  tone,
}: {
  label: string;
  cents: number;
  locale: Locale;
  strong?: boolean;
  tone?: "ok" | "bad";
}) {
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
        {formatSigned(cents, locale)}
      </dd>
    </div>
  );
}

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const { id: rawId } = await params;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.bank.account.eyebrow")} title={t("finance.bank.reconciliation.title")} />
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
      t(
        figures.unmatched_count === 1
          ? "finance.bank.reconciliation.unmatchedOne"
          : "finance.bank.reconciliation.unmatchedOther",
        { count: figures.unmatched_count },
      ),
    );
  }
  if (figures.statement_gap_cents !== 0) {
    problems.push(
      t("finance.bank.reconciliation.gap", {
        lines: formatSigned(figures.statement_lines_cents, locale),
        balances: formatSigned(rec.closing_balance_cents - rec.opening_balance_cents, locale),
      }),
    );
  }
  if (figures.difference_cents !== 0) {
    problems.push(t("finance.bank.reconciliation.difference", { amount: formatSigned(figures.difference_cents, locale) }));
  }
  const canClose = problems.length === 0;
  const accountLink = `/finance/bank/${account.id}?month=${rec.statement_start.slice(0, 7)}&show=unmatched`;

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.bank.reconciliation.eyebrow", { account: account.name })}
        title={t("finance.bank.reconciliation.heading", { start: rec.statement_start, end: rec.statement_end })}
        description={t("finance.bank.reconciliation.description")}
        actions={
          <>
            <Link href={`/finance/bank/${account.id}`} className="text-[13.5px] text-muted underline underline-offset-2">
              {t("finance.bank.reconciliation.backTo", { account: account.name })}
            </Link>
            <a
              href={`/api/finance/bank/reconciliations/${rec.id}`}
              className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm hover:bg-surface-soft"
            >
              <Download className="size-4" aria-hidden />
              {t("finance.bank.reconciliation.report")}
            </a>
          </>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="figures-heading">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="figures-heading" className="text-[15px] font-semibold">
              {t("finance.bank.reconciliation.figuresHeading")}
            </h2>
            {rec.status === "reconciled" ? (
              <Badge tone="success">{t("finance.bank.reconciled")}</Badge>
            ) : (
              <Badge tone="warning">{t("finance.bank.open")}</Badge>
            )}
          </div>
          <dl className="divide-y divide-line">
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.opening")} cents={rec.opening_balance_cents} />
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.lines")} cents={figures.statement_lines_cents} />
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.closing")} cents={rec.closing_balance_cents} strong />
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.ledger")} cents={figures.ledger_balance_cents} />
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.outstanding")} cents={figures.outstanding_cents} />
            <Figure locale={locale} label={t("finance.bank.reconciliation.figures.cleared")} cents={figures.cleared_balance_cents} strong />
            <Figure
              locale={locale}
              label={t("finance.bank.reconciliation.figures.difference")}
              cents={figures.difference_cents}
              strong
              tone={figures.difference_cents === 0 ? "ok" : "bad"}
            />
          </dl>
        </section>

        <section className="card p-4" aria-labelledby="close-heading">
          <h2 id="close-heading" className="mb-3 text-[15px] font-semibold">
            {rec.status === "reconciled" ? t("finance.bank.reconciled") : t("finance.bank.reconciliation.closeHeading")}
          </h2>
          {rec.status === "reconciled" ? (
            <p className="mb-3 text-[13.5px] text-muted">
              {t("finance.bank.reconciliation.reconciledNote", { date: rec.reconciled_at?.slice(0, 10) ?? "" })}
            </p>
          ) : canClose ? (
            <p className="mb-3 text-[13.5px] text-success-fg">{t("finance.bank.reconciliation.allClear")}</p>
          ) : (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-[13.5px]">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
              {figures.unmatched_count > 0 ? (
                <li>
                  <Link href={accountLink} className="underline underline-offset-2">
                    {t("finance.bank.reconciliation.matchRemaining")}
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
          {t("finance.bank.reconciliation.outstandingHeading", { count: outstanding.length })}
        </h2>
        {outstanding.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.bank.reconciliation.nothingOutstanding")}</p>
        ) : (
          <DataTable minWidth="560px">
            <TableHead>
              <TableHeader>{t("finance.common.date")}</TableHeader>
              <TableHeader>{t("finance.bank.reconciliation.entry")}</TableHeader>
              <TableHeader className="text-right">{t("finance.common.amount")}</TableHeader>
            </TableHead>
            <tbody>
              {outstanding.map((o) => (
                <TableRow key={o.journal_line_id}>
                  <TableCell className="tabular-nums">{o.entry_date}</TableCell>
                  <TableCell>
                    <Link href={`/finance/ledger/journal/${o.entry_id}`} className="underline underline-offset-2">
                      {t("finance.bank.entryNumber", { number: o.entry_number })}
                    </Link>{" "}
                    {o.memo}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(o.amount_cents, locale)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>

      <section aria-labelledby="stmt-heading">
        <h2 id="stmt-heading" className="mb-3 text-[15px] font-semibold">
          {t("finance.bank.reconciliation.linesHeading", { count: lines.length })}
        </h2>
        {lines.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.bank.reconciliation.noLines")}</p>
        ) : (
          <DataTable minWidth="640px">
            <TableHead>
              <TableHeader>{t("finance.common.date")}</TableHeader>
              <TableHeader>{t("finance.common.description")}</TableHeader>
              <TableHeader className="text-right">{t("finance.common.amount")}</TableHeader>
              <TableHeader>{t("finance.bank.account.ledger")}</TableHeader>
            </TableHead>
            <tbody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums whitespace-nowrap">{l.posted_on}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSigned(l.amount_cents, locale)}</TableCell>
                  <TableCell>
                    {l.entry_id ? (
                      <Link href={`/finance/ledger/journal/${l.entry_id}`} className="underline underline-offset-2">
                        {t("finance.bank.entryNumber", { number: l.entry_number ?? "" })}
                      </Link>
                    ) : (
                      <Badge tone="warning">{t("finance.bank.notMatched")}</Badge>
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
