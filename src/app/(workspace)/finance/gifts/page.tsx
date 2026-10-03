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
import { GIFT_SELECT, GIFT_TYPE_KEY, donorName, type GiftRow } from "@/features/gifts/services/gift.data";
import { recordGiftOptions } from "@/features/gifts/services/gift.options";
import { getLocale, getT } from "@/lib/i18n/server";
import { isCalendarYear } from "@/lib/schema";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.gifts.list.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function GiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const params = await searchParams;
  const today = todayIn(session.timeZone);
  const currentYear = Number(today.slice(0, 4));
  const year = isCalendarYear(params.year ?? "") ? Number(params.year) : currentYear;
  const options = canManage ? await recordGiftOptions(supabase, session.organizationId, today, t) : null;

  const header = (
    <PageHeader
      eyebrow={t("finance.common.title")}
      title={t("finance.gifts.title")}
      description={t("finance.gifts.list.description")}
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
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label={t("finance.gifts.list.yearFormLabel")}>
        <div>
          <Label htmlFor="gifts-year">{t("finance.gifts.list.yearReceived")}</Label>
          <Input id="gifts-year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-28" />
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.gifts.list.show")}
        </Button>
        <p className="ml-auto text-[13.5px] text-muted">
          {t(recorded.length === 1 ? "finance.gifts.list.summaryOne" : "finance.gifts.list.summaryOther", {
            count: recorded.length,
            total: formatCents(total, locale),
          })}
        </p>
      </form>
      {gifts.length === 0 ? (
        <EmptyState icon={<Gift />} title={t("finance.gifts.list.emptyTitle", { year })} description={t("finance.gifts.list.emptyDescription")} />
      ) : (
        <DataTable minWidth="760px">
          <TableHead>
            <TableHeader>{t("finance.gifts.list.colGift")}</TableHeader>
            <TableHeader>{t("finance.gifts.list.colReceived")}</TableHeader>
            <TableHeader>{t("finance.gifts.list.colDonor")}</TableHeader>
            <TableHeader>{t("finance.common.fund")}</TableHeader>
            <TableHeader className="text-right">{t("finance.common.amount")}</TableHeader>
          </TableHead>
          <tbody>
            {gifts.map((g) => (
              <TableRow key={g.id}>
                <TableCell>
                  <Link href={`/finance/gifts/${g.id}`} className="font-medium hover:underline">
                    {t("finance.gifts.list.giftNumber", { number: g.gift_number })}
                  </Link>
                  <p className="meta">{t(GIFT_TYPE_KEY[g.gift_type])}</p>
                  {g.status === "voided" ? <Badge tone="danger" className="mt-1">{t("finance.gifts.list.void")}</Badge> : null}
                </TableCell>
                <TableCell>{g.received_on}</TableCell>
                <TableCell>{donorName(g, t("finance.gifts.unknownDonor"))}</TableCell>
                <TableCell className="text-[13px]">
                  {g.fund ? `${g.fund.code} · ${g.fund.name}` : ""}
                  {g.program ? <p className="meta">{g.program.name}</p> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {g.amount_cents === null ? <span className="text-muted">{t("finance.gifts.list.noValue")}</span> : formatCents(Number(g.amount_cents), locale)}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
