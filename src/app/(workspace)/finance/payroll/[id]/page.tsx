import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCents } from "@/features/finance/money";
import { getLedgerAccess, uuidParam } from "@/features/ledger/services/ledger.access";
import {
  GROUP_LABEL,
  PAYROLL_CATEGORIES,
  PROVIDER_LABEL,
  categoryLabel,
  employeeDeductions,
  employerContributions,
} from "@/features/payroll/categories";
import { AccountMapDialog, AllocationForm, RunActions } from "@/features/payroll/components/payroll-forms";
import { NoPayrollAccess } from "@/features/payroll/components/no-payroll-access";
import {
  RUN_STATUS_LABEL,
  getAccountMap,
  getRun,
  payrollOptions,
  previewLines,
} from "@/features/payroll/services/payroll.queries";

export const metadata: Metadata = { title: "Pay run" };
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
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  if (!canRead) {
    return (
      <div>
        <PageHeader eyebrow="Payroll" title="Pay run" />
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
  const preview = draft ? await previewLines(supabase, run.id) : null;
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
        eyebrow="Payroll"
        title={`Pay run of ${run.pay_date}`}
        description={`Period ${run.period_start} to ${run.period_end}${run.run_reference ? ` · run ${run.run_reference}` : ""} · ${PROVIDER_LABEL[run.provider].replace(/ \(.*\)$/, "")}${run.file_name ? ` · ${run.file_name}` : ""}`}
        actions={
          canManage ? (
            <RunActions runId={run.id} status={run.status} payDate={run.pay_date} canPost={!preview?.error} />
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-[13.5px]">
        <Badge tone={STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
        {run.journal_entry_id ? (
          <Link className="font-medium text-brand-fg hover:underline" href={`/finance/ledger/journal/${run.journal_entry_id}`}>
            Journal entry {entryNumber ?? ""}
          </Link>
        ) : null}
        {run.reversal_entry_id ? (
          <Link className="font-medium text-brand-fg hover:underline" href={`/finance/ledger/journal/${run.reversal_entry_id}`}>
            Reversed by entry {reversalNumber ?? ""}
          </Link>
        ) : null}
        <Link className="text-muted hover:underline" href="/finance/payroll">
          All pay runs
        </Link>
      </div>

      <section aria-labelledby="totals" className="mb-8">
        <h2 id="totals" className="mb-2 text-[15px] font-semibold">
          Totals
        </h2>
        <DataTable minWidth="420px">
          <TableHead>
            <TableHeader>Category</TableHeader>
            <TableHeader className="w-40 text-right">Amount</TableHeader>
          </TableHead>
          <tbody>
            {(["wages", "employee", "employer", "net"] as const).map((group) => [
              ...PAYROLL_CATEGORIES.filter((c) => c.group === group).map((c) => (
                <TableRow key={c.key}>
                  <TableCell>
                    {group === "wages" || group === "net" ? c.label : `${GROUP_LABEL[group]}: ${c.label}`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(run.cents[c.key])}</TableCell>
                </TableRow>
              )),
              group === "employee" || group === "employer" ? (
                <TableRow key={`total-${group}`} className="font-semibold">
                  <TableCell>Total {GROUP_LABEL[group].toLowerCase()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(group === "employee" ? employeeDeductions(run.cents) : employerContributions(run.cents))}
                  </TableCell>
                </TableRow>
              ) : null,
            ])}
          </tbody>
        </DataTable>
        <p className="mt-2 text-[12.5px] text-muted">
          Run totals only. Employee names, social insurance numbers and per-employee lines were discarded when the file
          was read and are not stored.
        </p>
      </section>

      <section aria-labelledby="allocation" className="mb-8">
        <h2 id="allocation" className="mb-2 text-[15px] font-semibold">
          Allocation to funds and programs
        </h2>
        {draft && canManage ? (
          <div className="card p-4">
            <AllocationForm runId={run.id} grossCents={run.cents.gross_wages} allocation={allocation} options={options} />
          </div>
        ) : allocation.length === 0 ? (
          <p className="text-[13.5px] text-muted">The whole run goes to the general fund (GEN) with no program.</p>
        ) : (
          <ul className="space-y-1 text-[13.5px]">
            {allocation.map((a) => (
              <li key={a.share_no}>
                {fund.get(a.fund_id)?.code} {fund.get(a.fund_id)?.name}
                {a.program_id ? ` · ${program.get(a.program_id)?.name ?? ""}` : ""} ·{" "}
                {a.share_cents !== null ? formatCents(a.share_cents) : `${(a.share_basis_points ?? 0) / 100}%`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mapping" className="mb-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="mapping" className="text-[15px] font-semibold">
            Account mapping
          </h2>
          {canManage && draft ? <AccountMapDialog map={map} options={options} /> : null}
        </div>
        <DataTable minWidth="560px">
          <TableHead>
            <TableHeader>Category</TableHeader>
            <TableHeader>Debit</TableHeader>
            <TableHeader>Credit</TableHeader>
          </TableHead>
          <tbody>
            {map.map((m) => {
              const d = m.debit_account_id ? account.get(m.debit_account_id) : undefined;
              const c = m.credit_account_id ? account.get(m.credit_account_id) : undefined;
              const spec = PAYROLL_CATEGORIES.find((x) => x.key === m.category)!;
              return (
                <TableRow key={m.category}>
                  <TableCell>{categoryLabel(m.category)}</TableCell>
                  <TableCell className="text-[13px]">
                    {spec.debit ? (d ? `${d.code} ${d.name}` : <span className="text-danger-fg">Not mapped</span>) : ""}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {spec.credit ? (c ? `${c.code} ${c.name}` : <span className="text-danger-fg">Not mapped</span>) : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="entry">
        <h2 id="entry" className="mb-2 text-[15px] font-semibold">
          {draft ? "Journal entry to post" : "Posted journal entry"}
        </h2>
        {preview?.error ? (
          <p role="alert" className="text-[13.5px] text-danger-fg">
            {preview.error}
          </p>
        ) : (
          <DataTable minWidth="760px">
            <TableHead>
              <TableHeader className="w-12">#</TableHeader>
              <TableHeader>Account</TableHeader>
              <TableHeader className="w-28">Fund</TableHeader>
              <TableHeader>Program</TableHeader>
              <TableHeader>Description</TableHeader>
              <TableHeader className="w-32 text-right">Debit</TableHeader>
              <TableHeader className="w-32 text-right">Credit</TableHeader>
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
                    <TableCell className="text-right tabular-nums">{l.debit_cents ? formatCents(l.debit_cents) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit_cents ? formatCents(l.credit_cents) : ""}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold">
                <TableCell>{""}</TableCell>
                <TableCell>Total</TableCell>
                <TableCell>{""}</TableCell>
                <TableCell>{""}</TableCell>
                <TableCell>{debits === credits ? "Balanced" : "Not balanced"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(debits)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(credits)}</TableCell>
              </TableRow>
            </tbody>
          </DataTable>
        )}
        {draft ? (
          <p className="mt-2 text-[12.5px] text-muted">
            Posting creates this entry, dated on the pay date, through the ledger&rsquo;s own checks: it must balance
            overall and within each fund, fall in an open period, and respect restricted funds.
          </p>
        ) : null}
      </section>
    </div>
  );
}
