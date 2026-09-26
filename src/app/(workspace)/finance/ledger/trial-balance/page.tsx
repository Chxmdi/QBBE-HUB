import type { Metadata } from "next";
import Link from "next/link";
import { Download, Scale } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ACCOUNT_TYPE_LABEL, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { trialBalance } from "@/features/ledger/services/ledger.reports";

export const metadata: Metadata = { title: "Trial balance" };
export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Trial balance"
      description="The balance of every account from posted entries up to a date. Total debits always equal total credits."
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

  const asOf = dateParam(params.as_of, todayIn(session.timeZone));
  const fundId = uuidParam(params.fund);
  const [{ data: funds }, { rows, error }] = await Promise.all([
    supabase.from("ledger_fund").select("id, code, name").eq("organization_id", session.organizationId).order("code"),
    trialBalance(supabase, session.organizationId, asOf, fundId),
  ]);
  if (error) throw new Error(`Could not load the trial balance: ${error.message}`);
  const shown = rows.filter((r) => r.balance_cents !== 0);
  const debit = shown.reduce((s, r) => s + Math.max(r.balance_cents, 0), 0);
  const credit = shown.reduce((s, r) => s + Math.max(-r.balance_cents, 0), 0);
  const exportQuery = new URLSearchParams({ as_of: asOf, ...(fundId ? { fund: fundId } : {}) }).toString();

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label="Trial balance options">
        <div>
          <Label htmlFor="tb-as-of">As at</Label>
          <Input id="tb-as-of" name="as_of" type="date" defaultValue={asOf} />
        </div>
        <div className="min-w-48">
          <Label htmlFor="tb-fund">Fund</Label>
          <Select id="tb-fund" name="fund" defaultValue={fundId ?? ""}>
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
          href={`/api/finance/ledger/trial-balance?${exportQuery}`}
          prefetch={false}
          className="inline-flex h-9.5 items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </Link>
      </form>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title="Nothing posted up to this date"
          description="Balances appear here once entries are posted."
        />
      ) : (
        <DataTable minWidth="600px">
          <TableHead>
            <TableHeader className="w-24">Account</TableHeader>
            <TableHeader>Name</TableHeader>
            <TableHeader className="w-32">Type</TableHeader>
            <TableHeader className="w-36 text-right">Debit</TableHeader>
            <TableHeader className="w-36 text-right">Credit</TableHeader>
          </TableHead>
          <tbody>
            {shown.map((r) => (
              <TableRow key={r.account_id}>
                <TableCell className="font-mono tabular-nums">{r.code}</TableCell>
                <TableCell>
                  <Link
                    className="text-brand-fg hover:underline"
                    href={`/finance/ledger/general-ledger?account=${r.account_id}&to=${asOf}${fundId ? `&fund=${fundId}` : ""}`}
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="text-[13px] text-muted">{ACCOUNT_TYPE_LABEL[r.account_type]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.balance_cents > 0 ? formatCents(r.balance_cents) : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.balance_cents < 0 ? formatCents(-r.balance_cents) : ""}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{""}</TableCell>
              <TableCell>Total</TableCell>
              <TableCell>{""}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(debit)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(credit)}</TableCell>
            </TableRow>
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
