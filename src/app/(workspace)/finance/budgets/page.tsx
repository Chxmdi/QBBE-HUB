import type { Metadata } from "next";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fiscalYearLabel } from "@/features/budgets/budget";
import { CreateBudgetForm } from "@/features/budgets/components/budget-forms";
import { BudgetTabs } from "@/features/budgets/components/budget-tabs";
import { NoBudgetAccess } from "@/features/budgets/components/no-budget-access";
import { BUDGET_STATUS_LABEL, listBudgets } from "@/features/budgets/services/budget.queries";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.budgets.title") };
}
export const dynamic = "force-dynamic";

const STATUS_TONE = { draft: "warning", approved: "success", superseded: "neutral" } as const;

export default async function BudgetsPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const [t, locale, format] = await Promise.all([getT(), getLocale(), getFormatters()]);
  // English keeps the ISO day it always showed; French gets a written date.
  const day = (iso: string | null) =>
    iso ? (locale === "en" ? iso.slice(0, 10) : format.date(iso, session.timeZone)) : "";
  const header = (
    <PageHeader
      eyebrow={t("finance.common.title")}
      title={t("finance.budgets.title")}
      description={t("finance.budgets.list.description")}
    />
  );
  if (!canRead) {
    return (
      <div>
        {header}
        <BudgetTabs />
        <NoBudgetAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  const [budgets, { data: firstOpen }] = await Promise.all([
    listBudgets(supabase, session.organizationId),
    supabase
      .from("ledger_period")
      .select("starts_on")
      .eq("organization_id", session.organizationId)
      .eq("status", "open")
      .order("starts_on")
      .limit(1)
      .maybeSingle(),
  ]);
  const defaultMonth = (firstOpen?.starts_on as string | undefined)?.slice(0, 7) ?? todayIn(session.timeZone).slice(0, 7);

  return (
    <div>
      {header}
      <BudgetTabs />
      {canManage ? (
        <section aria-labelledby="new-budget" className="mb-6">
          <h2 id="new-budget" className="mb-2 text-[15px] font-semibold">
            {t("finance.budgets.list.newBudget")}
          </h2>
          <CreateBudgetForm defaultMonth={defaultMonth} />
        </section>
      ) : null}

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PiggyBank />}
          title={t("finance.budgets.list.emptyTitle")}
          description={canManage ? t("finance.budgets.list.emptyManage") : t("finance.budgets.list.emptyRead")}
        />
      ) : (
        <DataTable minWidth="640px">
          <TableHead>
            <TableHeader className="w-32">{t("finance.budgets.list.colFiscalYear")}</TableHeader>
            <TableHeader>{t("finance.budgets.budget")}</TableHeader>
            <TableHeader className="w-20">{t("finance.budgets.list.colVersion")}</TableHeader>
            <TableHeader className="w-32">{t("finance.common.status")}</TableHeader>
            <TableHeader className="w-36">{t("finance.budgets.list.colApproved")}</TableHeader>
            <TableHeader className="w-40">{""}</TableHeader>
          </TableHead>
          <tbody>
            {budgets.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{fiscalYearLabel(b.fiscal_year_start, locale)}</TableCell>
                <TableCell>
                  <Link className="text-brand-fg hover:underline" href={`/finance/budgets/${b.id}`}>
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{t("finance.budgets.list.versionShort", { version: b.version })}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[b.status]}>{t(BUDGET_STATUS_LABEL[b.status])}</Badge>
                </TableCell>
                <TableCell className="text-[13px] text-muted">{day(b.approved_at)}</TableCell>
                <TableCell>
                  <Link className="text-[13px] text-brand-fg hover:underline" href={`/finance/budgets/${b.id}/report`}>
                    {t("finance.budgets.budgetVsActual")}
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
