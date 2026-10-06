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
import { ACCOUNT_TYPE_KEY, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn, uuidParam } from "@/features/ledger/services/ledger.access";
import { trialBalance } from "@/features/ledger/services/ledger.reports";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledgerReports.trialBalance.title") };
}
export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead } = await getLedgerAccess();
  const params = await searchParams;
  const t = await getT();
  const locale = await getLocale();
  const header = (
    <PageHeader
      eyebrow={t("finance.ledgerReports.eyebrow")}
      title={t("finance.ledgerReports.trialBalance.title")}
      description={t("finance.ledgerReports.trialBalance.description")}
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
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4" aria-label={t("finance.ledgerReports.trialBalance.optionsLabel")}>
        <div>
          <Label htmlFor="tb-as-of">{t("finance.ledgerReports.trialBalance.asAt")}</Label>
          <Input id="tb-as-of" name="as_of" type="date" defaultValue={asOf} />
        </div>
        <div className="min-w-48">
          <Label htmlFor="tb-fund">{t("finance.common.fund")}</Label>
          <Select id="tb-fund" name="fund" defaultValue={fundId ?? ""}>
            <option value="">{t("finance.ledgerReports.allFunds")}</option>
            {((funds ?? []) as { id: string; code: string; name: string }[]).map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.ledgerReports.show")}
        </Button>
        <Link
          href={`/api/finance/ledger/trial-balance?${exportQuery}`}
          prefetch={false}
          className="inline-flex h-9.5 items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
        >
          <Download className="size-4" aria-hidden />
          {t("finance.common.exportCsv")}
        </Link>
      </form>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={t("finance.ledgerReports.trialBalance.emptyTitle")}
          description={t("finance.ledgerReports.trialBalance.emptyDescription")}
        />
      ) : (
        <DataTable minWidth="600px">
          <TableHead>
            <TableHeader className="w-24">{t("finance.common.account")}</TableHeader>
            <TableHeader>{t("finance.ledgerReports.name")}</TableHeader>
            <TableHeader className="w-32">{t("finance.ledgerReports.type")}</TableHeader>
            <TableHeader className="w-36 text-right">{t("finance.common.debit")}</TableHeader>
            <TableHeader className="w-36 text-right">{t("finance.common.credit")}</TableHeader>
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
                <TableCell className="text-[13px] text-muted">{t(ACCOUNT_TYPE_KEY[r.account_type])}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.balance_cents > 0 ? formatCents(r.balance_cents, locale) : ""}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.balance_cents < 0 ? formatCents(-r.balance_cents, locale) : ""}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{""}</TableCell>
              <TableCell>{t("finance.common.total")}</TableCell>
              <TableCell>{""}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(debit, locale)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCents(credit, locale)}</TableCell>
            </TableRow>
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
