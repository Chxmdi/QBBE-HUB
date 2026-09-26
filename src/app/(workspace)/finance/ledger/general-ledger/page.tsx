import type { Metadata } from "next";
import Link from "next/link";
import { BookText, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatBalance, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { GL_ROW_LIMIT, generalLedger, groupByAccount } from "@/features/ledger/services/ledger.reports";

export const metadata: Metadata = { title: "General ledger" };
export const dynamic = "force-dynamic";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="General ledger"
      description="Every posted line by account, with the balance brought forward and a running balance."
    />
  );
  if (!canRead) {
    return (
      <div>
        {header}
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const today = todayIn(session.timeZone);
  const to = dateParam(params.to, today);
  const from = dateParam(params.from, `${to.slice(0, 7)}-01`);
  const accountId = uuidParam(params.account);
  const fundId = uuidParam(params.fund);
  const [{ data: accounts }, { data: funds }, { rows, error, truncated }] = await Promise.all([
    supabase.from("ledger_account").select("id, code, name").eq("organization_id", session.organizationId).order("code"),
    supabase.from("ledger_fund").select("id, code, name").eq("organization_id", session.organizationId).order("code"),
    generalLedger(supabase, session.organizationId, from, to, accountId, fundId),
  ]);
  if (error) throw new Error(`Could not load the general ledger: ${error.message}`);
  const groups = groupByAccount(rows);
  const exportQuery = new URLSearchParams({
    from,
    to,
    ...(accountId ? { account: accountId } : {}),
    ...(fundId ? { fund: fundId } : {}),
  }).toString();

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 lg:grid-cols-6" aria-label="General ledger options">
        <div>
          <Label htmlFor="gl-from">From</Label>
          <Input id="gl-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="gl-to">To</Label>
          <Input id="gl-to" name="to" type="date" defaultValue={to} />
        </div>
        <div className="col-span-2 lg:col-span-1">
          <Label htmlFor="gl-account">Account</Label>
          <Select id="gl-account" name="account" defaultValue={accountId ?? ""}>
            <option value="">All accounts</option>
            {((accounts ?? []) as { id: string; code: string; name: string }[]).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="col-span-2 lg:col-span-1">
          <Label htmlFor="gl-fund">Fund</Label>
          <Select id="gl-fund" name="fund" defaultValue={fundId ?? ""}>
            <option value="">All funds</option>
            {((funds ?? []) as { id: string; code: string; name: string }[]).map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <Link
          href={`/api/finance/ledger/general-ledger?${exportQuery}`}
          prefetch={false}
          className="inline-flex h-9.5 items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </Link>
      </form>

      {truncated ? (
        <p className="meta mb-3">Showing the first {GL_ROW_LIMIT} lines. Narrow the dates or choose an account.</p>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          icon={<BookText />}
          title="No posted lines in this range"
          description="Try a wider date range, another account or all funds."
        />
      ) : (
        groups.map((g) => {
          const closing = g.rows.at(-1)?.running_cents ?? g.opening;
          return (
            <section key={g.accountId} aria-labelledby={`gl-${g.accountId}`} className="mb-6">
              <h2 id={`gl-${g.accountId}`} className="mb-2 text-[15px] font-semibold">
                <span className="font-mono tabular-nums">{g.code}</span> {g.name}
              </h2>
              <DataTable minWidth="760px">
                <TableHead>
                  <TableHeader className="w-28">Date</TableHeader>
                  <TableHeader className="w-16">Entry</TableHeader>
                  <TableHeader>Memo</TableHeader>
                  <TableHeader className="w-20">Fund</TableHeader>
                  <TableHeader className="w-32 text-right">Debit</TableHeader>
                  <TableHeader className="w-32 text-right">Credit</TableHeader>
                  <TableHeader className="w-36 text-right">Balance</TableHeader>
                </TableHead>
                <tbody>
                  <TableRow className="text-muted">
                    <TableCell className="tabular-nums">{from}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>Balance brought forward</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBalance(g.opening)}</TableCell>
                  </TableRow>
                  {g.rows.map((r) => (
                    <TableRow key={r.line_id}>
                      <TableCell className="tabular-nums">{r.entry_date}</TableCell>
                      <TableCell className="tabular-nums">
                        <Link className="text-brand-fg hover:underline" href={`/finance/ledger/journal/${r.entry_id}`}>
                          {r.entry_number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.memo}
                        {r.line_description ? <p className="meta">{r.line_description}</p> : null}
                      </TableCell>
                      <TableCell className="font-mono">{r.fund_code}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.debit_cents ? formatCents(r.debit_cents) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.credit_cents ? formatCents(r.credit_cents) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatBalance(r.running_cents)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell className="tabular-nums">{to}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>Closing balance</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell>{""}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBalance(closing)}</TableCell>
                  </TableRow>
                </tbody>
              </DataTable>
            </section>
          );
        })
      )}
    </div>
  );
}
