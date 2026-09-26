import type { Metadata } from "next";
import Link from "next/link";
import { Gift } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { NotAReceiptNotice } from "@/features/gifts/components/not-a-receipt-notice";
import { RecordGiftDialog } from "@/features/gifts/components/record-gift-dialog";
import { GIFT_SELECT, GIFT_TYPE_LABEL, donorName, type GiftRow } from "@/features/gifts/services/gift.data";
import { recordGiftOptions } from "@/features/gifts/services/gift.options";

export const metadata: Metadata = { title: "Gifts" };
export const dynamic = "force-dynamic";

export default async function GiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const today = todayIn(session.timeZone);
  const currentYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : currentYear;
  const options = canManage ? await recordGiftOptions(supabase, session.organizationId, today) : null;

  const header = (
    <PageHeader
      eyebrow="Finance"
      title="Gifts and grants"
      description="Donations, grant payments and in-kind gifts, each linked to a donor in Relationships and, when it has a dollar amount, to its ledger entry."
      actions={options ? <RecordGiftDialog options={options} /> : undefined}
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

  const { data } = await supabase
    .from("gift")
    .select(GIFT_SELECT)
    .eq("organization_id", session.organizationId)
    .gte("received_on", `${year}-01-01`)
    .lte("received_on", `${year}-12-31`)
    .order("received_on", { ascending: false })
    .order("gift_number", { ascending: false })
    .limit(1000);
  const gifts = (data ?? []) as unknown as GiftRow[];
  // Donor names on screen are a read of donor data: record who looked, and when.
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "gifts",
    action: "gift_list_viewed",
    object_type: "organization",
    object_id: session.organizationId,
    metadata: { year, rows: gifts.length },
  });
  const recorded = gifts.filter((g) => g.status === "recorded");
  const total = recorded.reduce((sum, g) => sum + (g.gift_type === "in_kind" ? 0 : Number(g.amount_cents ?? 0)), 0);

  return (
    <div>
      {header}
      <GiftTabs />
      <NotAReceiptNotice />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Choose the year">
        <div>
          <Label htmlFor="gifts-year">Year received</Label>
          <Input id="gifts-year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-28" />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <p className="ml-auto text-[13.5px] text-muted">
          {recorded.length} gift{recorded.length === 1 ? "" : "s"} · {formatCents(total)} received in money
        </p>
      </form>
      {gifts.length === 0 ? (
        <EmptyState icon={<Gift />} title={`No gifts recorded in ${year}`} description="Recorded gifts appear here." />
      ) : (
        <DataTable minWidth="760px">
          <TableHead>
            <TableHeader>Gift</TableHeader>
            <TableHeader>Received</TableHeader>
            <TableHeader>Donor</TableHeader>
            <TableHeader>Fund</TableHeader>
            <TableHeader className="text-right">Amount</TableHeader>
          </TableHead>
          <tbody>
            {gifts.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <Link href={`/finance/gifts/${g.id}`} className="font-medium hover:underline">
                    Gift {g.gift_number}
                  </Link>
                  <p className="meta">{GIFT_TYPE_LABEL[g.gift_type]}</p>
                  {g.status === "voided" ? <Badge tone="danger" className="mt-1">Void</Badge> : null}
                </TableCell>
                <TableCell>{g.received_on}</TableCell>
                <TableCell>{donorName(g)}</TableCell>
                <TableCell className="text-[13px]">
                  {g.fund ? `${g.fund.code} · ${g.fund.name}` : ""}
                  {g.program ? <p className="meta">{g.program.name}</p> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.amount_cents === null ? <span className="text-muted">No value</span> : formatCents(Number(g.amount_cents))}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
