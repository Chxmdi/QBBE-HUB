import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ENTRY_KIND_LABEL, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 500;

interface EntryRow {
  id: string;
  entry_number: number | null;
  entry_date: string;
  memo: string;
  kind: string;
  status: "draft" | "posted";
  journal_line: { debit_cents: number }[];
}

export default async function LedgerJournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Journal"
      description="Every entry, newest first. Drafts can be edited or deleted; posted entries are permanent and are corrected by reversing them."
      actions={
        canRead && canManage ? (
          <Link
            href="/finance/ledger/journal/new"
            className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
          >
            <Plus className="size-4" aria-hidden />
            New entry
          </Link>
        ) : undefined
      }
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

  const status = params.status === "draft" || params.status === "posted" ? params.status : "";
  const from = params.from ? dateParam(params.from, "") : "";
  const to = params.to ? dateParam(params.to, "") : "";

  let query = supabase
    .from("journal_entry")
    .select("id, entry_number, entry_date, memo, kind, status, journal_line(debit_cents)")
    .eq("organization_id", session.organizationId);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  const { data } = await query
    .order("entry_date", { ascending: false })
    .order("entry_number", { ascending: false, nullsFirst: true })
    .limit(PAGE_LIMIT);
  const rows = (data ?? []) as unknown as EntryRow[];
  const filtered = Boolean(status || from || to);

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-4" aria-label="Filter entries">
        <div>
          <Label htmlFor="j-from">From</Label>
          <Input id="j-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="j-to">To</Label>
          <Input id="j-to" name="to" type="date" defaultValue={to} />
        </div>
        <div>
          <Label htmlFor="j-status">Status</Label>
          <Select id="j-status" name="status" defaultValue={status}>
            <option value="">Any status</option>
            <option value="posted">Posted</option>
            <option value="draft">Draft</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Link
              href="/finance/ledger/journal"
              className="inline-flex h-9.5 items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={filtered ? "No entries match these filters" : "No journal entries yet"}
          description={
            filtered ? "Try a wider date range or clear the filters." : "Start with the opening balances from the accountant."
          }
        />
      ) : (
        <>
          {rows.length === PAGE_LIMIT ? <p className="meta mb-2">Showing the latest {PAGE_LIMIT}.</p> : null}
          <DataTable minWidth="680px">
            <TableHead>
              <TableHeader className="w-20">No.</TableHeader>
              <TableHeader className="w-28">Date</TableHeader>
              <TableHeader>Memo</TableHeader>
              <TableHeader className="w-32">Status</TableHeader>
              <TableHeader className="w-36 text-right">Amount</TableHeader>
            </TableHead>
            <tbody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{e.entry_number ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{e.entry_date}</TableCell>
                  <TableCell>
                    <Link href={`/finance/ledger/journal/${e.id}`} className="font-medium text-brand-fg hover:underline">
                      {e.memo}
                    </Link>
                    {e.kind !== "standard" ? <p className="meta">{ENTRY_KIND_LABEL[e.kind]}</p> : null}
                  </TableCell>
                  <TableCell>
                    {e.status === "posted" ? <Badge tone="success">Posted</Badge> : <Badge tone="warning">Draft</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(e.journal_line.reduce((s, l) => s + Number(l.debit_cents), 0))}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
