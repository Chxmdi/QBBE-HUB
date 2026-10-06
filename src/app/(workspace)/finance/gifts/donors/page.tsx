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
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.gifts.donors.metaTitle") };
}
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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const params = await searchParams;
  const today = todayIn(session.timeZone);
  const from = dateParam(params.from, `${today.slice(0, 4)}-01-01`);
  const to = dateParam(params.to, today);
  const header = (
    <PageHeader
      eyebrow={t("finance.gifts.tabs.gifts")}
      title={t("finance.gifts.donors.metaTitle")}
      description={t("finance.gifts.donors.description")}
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
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label={t("finance.gifts.donors.periodFormLabel")}>
        <div>
          <Label htmlFor="donors-from">{t("finance.gifts.donors.from")}</Label>
          <Input id="donors-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="donors-to">{t("finance.gifts.donors.to")}</Label>
          <Input id="donors-to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.gifts.list.show")}
        </Button>
        <a
          href={`/api/finance/gifts/donors/export?from=${from}&to=${to}`}
          className="ml-auto inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          <Download className="size-4" aria-hidden />
          {t("finance.common.exportCsv")}
        </a>
      </form>
      {from > to ? (
        <p role="alert" className="mb-4 text-[13px] text-danger-fg">
          {t("finance.gifts.donors.badRange")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-danger-fg">
          {t("finance.gifts.donors.loadError")}
        </p>
      ) : donors.length === 0 ? (
        <EmptyState icon={<Users />} title={t("finance.gifts.donors.empty")} />
      ) : (
        <DataTable minWidth="720px">
          <TableHead>
            <TableHeader>{t("finance.gifts.donors.colDonor")}</TableHeader>
            <TableHeader className="text-right">{t("finance.gifts.donors.colGifts")}</TableHeader>
            <TableHeader className="text-right">{t("finance.gifts.donors.colReceivedMoney")}</TableHeader>
            <TableHeader>{t("finance.gifts.donors.colLastGift")}</TableHeader>
            <TableHeader>
              <span className="sr-only">{t("finance.gifts.donors.colStatement")}</span>
            </TableHeader>
          </TableHead>
          <tbody>
            {donors.map((d) => (
              <TableRow key={`${d.donor_kind}:${d.donor_id}`}>
                <TableCell>
                  {d.donor_name}
                  <p className="meta">{t(d.donor_kind === "contact" ? "finance.gifts.donors.person" : "finance.gifts.donors.organization")}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(d.gift_count)}
                  {Number(d.in_kind_count) > 0 ? <p className="meta">{t("finance.gifts.donors.inKindCount", { count: Number(d.in_kind_count) })}</p> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCents(Number(d.total_cents), locale)}</TableCell>
                <TableCell>{d.last_gift_on}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/finance/gifts/statement?donor=${d.donor_kind}:${d.donor_id}&year=${year}`}
                    className="text-[13px] underline"
                  >
                    {t("finance.gifts.donors.statementLink", { year })}
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
