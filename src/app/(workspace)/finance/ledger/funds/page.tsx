import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FundDialog, type FundFormValue } from "@/features/ledger/components/fund-dialog";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FUND_RESTRICTION_KEY, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.funds.title") };
}
export const dynamic = "force-dynamic";

interface FundBalance {
  fund_id: string;
  assets_cents: number;
  liabilities_cents: number;
  fund_balance_cents: number;
}

export default async function LedgerFundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const t = await getT();
  const locale = await getLocale();
  const params = await searchParams;
  const asOf = dateParam(params.as_of, todayIn(session.timeZone));
  const { data: programs } = canManage
    ? await supabase.from("program").select("id, name").eq("organization_id", session.organizationId).eq("status", "active").order("name")
    : { data: [] };
  const programList = (programs ?? []) as { id: string; name: string }[];

  const header = (
    <PageHeader
      eyebrow={t("finance.ledger.title")}
      title={t("finance.ledger.funds.title")}
      description={t("finance.ledger.funds.description")}
      actions={
        canRead ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/finance/ledger/funds/release"
              className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-soft"
            >
              {canManage ? t("finance.ledger.funds.releaseLink") : t("finance.ledger.funds.releasesLink")}
            </Link>
            {canManage ? <FundDialog programs={programList} /> : null}
          </div>
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

  const [{ data: funds }, { data: links }, { data: balances }, { data: allPrograms }] = await Promise.all([
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction, funder, starts_on, ends_on, description, is_active")
      .eq("organization_id", session.organizationId)
      .order("code"),
    supabase.from("ledger_fund_program").select("fund_id, program_id").eq("organization_id", session.organizationId),
    supabase
      .rpc("ledger_fund_balances", { p_organization: session.organizationId, p_as_of: asOf })
      .throwOnError(),
    supabase.from("program").select("id, name").eq("organization_id", session.organizationId),
  ]);

  const programName = new Map(((allPrograms ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const byFund = new Map<string, string[]>();
  for (const l of (links ?? []) as { fund_id: string; program_id: string }[]) {
    byFund.set(l.fund_id, [...(byFund.get(l.fund_id) ?? []), l.program_id]);
  }
  const balanceOf = new Map(((balances ?? []) as FundBalance[]).map((b) => [b.fund_id, b]));
  const rows: FundFormValue[] = ((funds ?? []) as Omit<FundFormValue, "programIds" | "used">[]).map((f) => {
    const b = balanceOf.get(f.id);
    return {
      ...f,
      programIds: byFund.get(f.id) ?? [],
      used: Boolean(b && (Number(b.assets_cents) !== 0 || Number(b.liabilities_cents) !== 0 || Number(b.fund_balance_cents) !== 0)),
    };
  });
  const total = rows.reduce((sum, f) => sum + Number(balanceOf.get(f.id)?.fund_balance_cents ?? 0), 0);

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label={t("finance.ledger.funds.dateFormLabel")}>
        <div>
          <Label htmlFor="funds-as-of">{t("finance.ledger.funds.balancesAsAt")}</Label>
          <Input id="funds-as-of" name="as_of" type="date" defaultValue={asOf} />
        </div>
        <Button type="submit" variant="secondary">
          {t("finance.ledger.funds.show")}
        </Button>
      </form>
      <DataTable minWidth="760px">
        <TableHead>
          <TableHeader>{t("finance.common.fund")}</TableHeader>
          <TableHeader>{t("finance.ledger.funds.restriction")}</TableHeader>
          <TableHeader>{t("finance.ledger.funds.spendingLimits")}</TableHeader>
          <TableHeader className="text-right">{t("finance.ledger.funds.fundBalance")}</TableHeader>
          {canManage ? (
            <TableHeader className="w-16">
              <span className="sr-only">{t("finance.ledger.edit")}</span>
            </TableHeader>
          ) : null}
        </TableHead>
        <tbody>
          {rows.map((f) => (
            <TableRow key={f.id}>
              <TableCell>
                <span className="font-mono">{f.code}</span> · {f.name}
                {f.funder ? <p className="meta">{t("finance.ledger.funds.funder", { funder: f.funder })}</p> : null}
                {!f.is_active ? <Badge className="mt-1">{t("finance.ledger.status.inactive")}</Badge> : null}
              </TableCell>
              <TableCell>
                <Badge tone={f.restriction === "unrestricted" ? "neutral" : f.restriction === "externally_restricted" ? "warning" : "info"}>
                  {t(FUND_RESTRICTION_KEY[f.restriction])}
                </Badge>
              </TableCell>
              <TableCell className="text-[13px]">
                {f.restriction === "unrestricted" ? (
                  <span className="text-muted">{t("finance.common.none")}</span>
                ) : (
                  <>
                    <p>
                      {f.starts_on || f.ends_on
                        ? t("finance.ledger.funds.dateRange", {
                            from: f.starts_on ?? t("finance.ledger.funds.anyTime"),
                            to: f.ends_on ?? t("finance.ledger.funds.noEndDate"),
                          })
                        : t("finance.ledger.funds.anyDates")}
                    </p>
                    <p className="meta">
                      {f.programIds.length > 0
                        ? f.programIds.map((id) => programName.get(id) ?? t("finance.ledger.funds.unknownProgram")).join(", ")
                        : t("finance.ledger.funds.anyProgram")}
                    </p>
                  </>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCents(Number(balanceOf.get(f.id)?.fund_balance_cents ?? 0), locale)}
              </TableCell>
              {canManage ? (
                <TableCell>
                  <FundDialog fund={f} programs={programList} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>{t("finance.ledger.funds.allFunds")}</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(total, locale)}</TableCell>
            {canManage ? <TableCell>{""}</TableCell> : null}
          </TableRow>
        </tbody>
      </DataTable>
      <p className="meta mt-2">
        {t("finance.ledger.funds.balanceNote")}
      </p>
    </div>
  );
}
