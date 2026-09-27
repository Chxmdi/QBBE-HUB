import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/finance/money";
import { getLedgerAccess, uuidParam } from "@/features/ledger/services/ledger.access";
import {
  PAYROLL_CATEGORIES,
  categoryLabel,
  categoryShortKey,
  employeeDeductions,
  employerContributions,
  groupKey,
  providerShortLabel,
} from "@/features/payroll/categories";
import { AccountMapDialog, AllocationForm, RunActions } from "@/features/payroll/components/payroll-forms";
import { NoPayrollAccess } from "@/features/payroll/components/no-payroll-access";
import {
  RUN_STATUS_KEY,
  getAccountMap,
  getRun,
  payrollOptions,
  previewLines,
} from "@/features/payroll/services/payroll.queries";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.payroll.run.metaTitle") };
}
export const dynamic = "force-dynamic";

interface EntryLine {
  line_no: number;
  account_id: string;
  fund_id: string;
  program_id: string | null;
  description: string | null;
  debit_cents: number;
  credit_cents: number;
}

const STATUS_TONE = { draft: "warning", posted: "success", reversed: "neutral" } as const;

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const money = (cents: number) => formatCents(cents, locale);
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow={t("finance.payroll.title")} title={t("finance.payroll.run.metaTitle")} />
        <NoPayrollAccess isAdmin={session.isAdmin} />
      </div>
    );
  }
  const runId = uuidParam(id);
  if (!runId) notFound();
  const [found, map, options] = await Promise.all([
    getRun(supabase, session.organizationId, runId),
    getAccountMap(supabase, session.organizationId),
    payrollOptions(supabase, session.organizationId),
  ]);
  if (!found) notFound();
  const { run, allocation, entryNumbers } = found;
  const draft = run.status === "draft";
  // Posted runs show the entry that was posted; drafts, the one posting would make.
  const preview = draft ? await previewLines(supabase, run.id, t("finance.payroll.run.previewFailed")) : null;
  const { data: postedLines } = draft
    ? { data: null }
    : await supabase
        .from("journal_line")
        .select("line_no, account_id, fund_id, program_id, description, debit_cents, credit_cents")
        .eq("entry_id", run.journal_entry_id!)
        .order("line_no");
  const lines: EntryLine[] =
    preview?.lines ??
    ((postedLines ?? []) as EntryLine[]).map((l) => ({
      ...l,
      debit_cents: Number(l.debit_cents),
      credit_cents: Number(l.credit_cents),
    }));

  const account = new Map(options.accounts.map((a) => [a.id, a]));
  const fund = new Map(options.funds.map((f) => [f.id, f]));
  const program = new Map(options.programs.map((p) => [p.id, p]));
  const debits = lines.reduce((s, l) => s + l.debit_cents, 0);
  const credits = lines.reduce((s, l) => s + l.credit_cents, 0);
  const entryNumber = run.journal_entry_id ? entryNumbers[run.journal_entry_id] : undefined;
  const reversalNumber = run.reversal_entry_id ? entryNumbers[run.reversal_entry_id] : undefined;

  return (
    <div>
      <PageHeader
        eyebrow={t("finance.payroll.title")}
        title={t("finance.payroll.run.heading", { date: run.pay_date })}
        description={[
          t("finance.payroll.run.descriptionPeriod", { start: run.period_start, end: run.period_end }),
          run.run_reference ? t("finance.payroll.run.descriptionRun", { reference: run.run_reference }) : null,
          providerShortLabel(run.provider, t),
          run.file_name,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canManage ? (
            <RunActions runId={run.id} status={run.status} payDate={run.pay_date} canPost={!preview?.error} />
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-[13.5px]">
        <Badge tone={STATUS_TONE[run.status]}>{t(RUN_STATUS_KEY[run.status])}</Badge>
        {run.journal_entry_id ? (
          <Link className="font-medium text-brand-fg hover:underline" href={`/finance/ledger/journal/${run.journal_entry_id}`}>
            {t("finance.payroll.run.journalEntry", { number: entryNumber ?? "" })}
          </Link>
        ) : null}
        {run.reversal_entry_id ? (
          <Link className="font-medium text-brand-fg hover:underline" href={`/finance/ledger/journal/${run.reversal_entry_id}`}>
            {t("finance.payroll.run.reversedBy", { number: reversalNumber ?? "" })}
          </Link>
        ) : null}
        <Link className="text-muted hover:underline" href="/finance/payroll">
          {t("finance.payroll.run.allRuns")}
        </Link>
      </div>

      <section aria-labelledby="totals" className="mb-8">
        <h2 id="totals" className="mb-2 text-[15px] font-semibold">
          {t("finance.payroll.run.totalsHeading")}
        </h2>
        <DataTable minWidth="420px">
          <TableHead>
            <TableHeader>{t("finance.payroll.run.category")}</TableHeader>
            <TableHeader className="w-40 text-right">{t("finance.common.amount")}</TableHeader>
          </TableHead>
          <tbody>
            {(["wages", "employee", "employer", "net"] as const).map((group) => [
              ...PAYROLL_CATEGORIES.filter((c) => c.group === group).map((c) => (
                <TableRow key={c.key}>
                  <TableCell>
                    {group === "wages" || group === "net"
                      ? t(categoryShortKey(c.key))
                      : t("finance.payroll.run.groupedCategory", {
                          group: t(groupKey(group)),
                          category: t(categoryShortKey(c.key)),
                        })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(run.cents[c.key])}</TableCell>
                </TableRow>
              )),
              group === "employee" || group === "employer" ? (
                <TableRow key={`total-${group}`} className="font-semibold">
                  <TableCell>{t(`finance.payroll.groupTotals.${group}`)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(group === "employee" ? employeeDeductions(run.cents) : employerContributions(run.cents))}
                  </TableCell>
                </TableRow>
              ) : null,
            ])}
          </tbody>
        </DataTable>
        <p className="mt-2 text-[12.5px] text-muted">{t("finance.payroll.run.totalsNote")}</p>
      </section>

      <section aria-labelledby="allocation" className="mb-8">
        <h2 id="allocation" className="mb-2 text-[15px] font-semibold">
          {t("finance.payroll.run.allocationHeading")}
        </h2>
        {draft && canManage ? (
          <div className="card p-4">
            <AllocationForm runId={run.id} grossCents={run.cents.gross_wages} allocation={allocation} options={options} />
          </div>
        ) : allocation.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.payroll.run.allocationNone")}</p>
        ) : (
          <ul className="space-y-1 text-[13.5px]">
            {allocation.map((a) => (
              <li key={a.share_no}>
                {fund.get(a.fund_id)?.code} {fund.get(a.fund_id)?.name}
                {a.program_id ? ` · ${program.get(a.program_id)?.name ?? ""}` : ""} ·{" "}
                {a.share_cents !== null
                  ? money(a.share_cents)
                  : t("finance.payroll.run.sharePercent", {
                      value: formatNumber((a.share_basis_points ?? 0) / 100, locale),
                    })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mapping" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="mapping" className="text-[15px] font-semibold">
            {t("finance.payroll.run.mappingHeading")}
          </h2>
          {canManage && draft ? <AccountMapDialog map={map} options={options} /> : null}
        </div>
        <DataTable minWidth="560px">
          <TableHead>
            <TableHeader>{t("finance.payroll.run.category")}</TableHeader>
            <TableHeader>{t("finance.common.debit")}</TableHeader>
            <TableHeader>{t("finance.common.credit")}</TableHeader>
          </TableHead>
          <tbody>
            {map.map((m) => {
              const d = m.debit_account_id ? account.get(m.debit_account_id) : undefined;
              const c = m.credit_account_id ? account.get(m.credit_account_id) : undefined;
              const spec = PAYROLL_CATEGORIES.find((x) => x.key === m.category)!;
              return (
                <TableRow key={m.category}>
                  <TableCell>{categoryLabel(m.category, t)}</TableCell>
                  <TableCell className="text-[13px]">
                    {spec.debit ? (d ? `${d.code} ${d.name}` : <span className="text-danger-fg">{t("finance.payroll.run.notMapped")}</span>) : ""}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {spec.credit ? (c ? `${c.code} ${c.name}` : <span className="text-danger-fg">{t("finance.payroll.run.notMapped")}</span>) : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="entry">
        <h2 id="entry" className="mb-2 text-[15px] font-semibold">
          {draft ? t("finance.payroll.run.entryToPost") : t("finance.payroll.run.postedEntry")}
        </h2>
        {preview?.error ? (
          <p role="alert" className="text-[13.5px] text-danger-fg">
            {preview.error}
          </p>
        ) : (
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-12">{t("finance.payroll.run.lineNumber")}</TableHeader>
              <TableHeader>{t("finance.common.account")}</TableHeader>
              <TableHeader className="w-28">{t("finance.common.fund")}</TableHeader>
              <TableHeader>{t("finance.common.program")}</TableHeader>
              <TableHeader>{t("finance.common.description")}</TableHeader>
              <TableHeader className="w-32 text-right">{t("finance.common.debit")}</TableHeader>
              <TableHeader className="w-32 text-right">{t("finance.common.credit")}</TableHeader>
            </TableHead>
            <tbody>
              {lines.map((l) => {
                const a = account.get(l.account_id);
                return (
                  <TableRow key={l.line_no}>
                    <TableCell className="tabular-nums text-muted">{l.line_no}</TableCell>
                    <TableCell className="text-[13px]">
                      {a?.code} {a?.name}
                    </TableCell>
                    <TableCell className="text-[13px]">{fund.get(l.fund_id)?.code}</TableCell>
                    <TableCell className="text-[13px]">{l.program_id ? program.get(l.program_id)?.name : ""}</TableCell>
                    <TableCell className="text-[13px]">{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debit_cents ? money(l.debit_cents) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit_cents ? money(l.credit_cents) : ""}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold">
                <TableCell>{""}</TableCell>
                <TableCell>{t("finance.common.total")}</TableCell>
                <TableCell>{""}</TableCell>
                <TableCell>{""}</TableCell>
                <TableCell>{debits === credits ? t("finance.payroll.run.balanced") : t("finance.payroll.run.notBalanced")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(debits)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(credits)}</TableCell>
              </TableRow>
            </tbody>
          </DataTable>
        )}
        {draft ? (
          <p className="mt-2 text-[12.5px] text-muted">{t("finance.payroll.run.postingNote")}</p>
        ) : null}
      </section>
    </div>
  );
}
