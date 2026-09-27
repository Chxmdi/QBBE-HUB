import type { Metadata } from "next";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";

export const metadata: Metadata = { title: "Donors" };
export const dynamic = "force-dynamic";

interface DonorRow {
  donor_kind: "contact" | "organization";
  donor_id: string;
  donor_name: string;
  donor_email: string | null;
  gift_count: number;
  total_cents: number;
  in_kind_count: number;
  first_gift_on: string;
  last_gift_on: string;
}

export default async function DonorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const today = todayIn(session.timeZone);
  const from = dateParam(params.from, `${today.slice(0, 4)}-01-01`);
  const to = dateParam(params.to, today);
  const header = (
    <PageHeader
      eyebrow="Gifts"
      title="Donors"
      description="Everyone who gave in the period, with their totals. Donor information is personal: every view and export of this list is recorded in the audit log."
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

  // The database writes the audit record for this read.
  const { data, error } =
    from <= to
      ? await supabase.rpc("gift_donor_list", {
          p_organization: session.organizationId,
          p_from: from,
          p_to: to,
          p_purpose: "view",
        })
      : { data: [], error: null };
  const donors = (data ?? []) as DonorRow[];
  const year = to.slice(0, 4);

  return (
    <div>
      {header}
      <GiftTabs />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Choose the period">
        <div>
          <Label htmlFor="donors-from">From</Label>
          <Input id="donors-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="donors-to">To</Label>
          <Input id="donors-to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <a
          href={`/api/finance/gifts/donors/export?from=${from}&to=${to}`}
          className="ml-auto inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </a>
      </form>
      {from > to ? (
        <p role="alert" className="mb-4 text-[13px] text-danger-fg">
          The start date must be on or before the end date.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-danger-fg">
          Could not load donors. Try again.
        </p>
      ) : donors.length === 0 ? (
        <EmptyState icon={<Users />} title="No gifts in this period" />
      ) : (
        <DataTable minWidth="720px">
          <TableHead>
            <TableHeader>Donor</TableHeader>
            <TableHeader className="text-right">Gifts</TableHeader>
            <TableHeader className="text-right">Received in money</TableHeader>
            <TableHeader>Last gift</TableHeader>
            <TableHeader>
              <span className="sr-only">Statement</span>
            </TableHeader>
          </TableHead>
          <tbody>
            {donors.map((d) => (
              <TableRow key={`${d.donor_kind}:${d.donor_id}`}>
                <TableCell>
                  {d.donor_name}
                  <p className="meta">{d.donor_kind === "contact" ? "Person" : "Organization"}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(d.gift_count)}
                  {Number(d.in_kind_count) > 0 ? <p className="meta">{Number(d.in_kind_count)} in kind</p> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(Number(d.total_cents))}</TableCell>
                <TableCell>{d.last_gift_on}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/finance/gifts/statement?donor=${d.donor_kind}:${d.donor_id}&year=${year}`}
                    className="text-[13px] underline"
                  >
                    {year} statement
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
