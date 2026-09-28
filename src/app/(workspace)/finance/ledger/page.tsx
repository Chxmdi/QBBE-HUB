import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ChartApprovalForm, LedgerReaders } from "@/features/ledger/components/setup-forms";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.title") };
}
export const dynamic = "force-dynamic";

function Step({
  done,
  title,
  t,
  children,
}: {
  done: boolean;
  title: string;
  t: TranslateFn;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 py-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-fg" aria-hidden />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {title}
          <span className="sr-only">{` (${done ? t("finance.ledger.home.stepDone") : t("finance.ledger.home.stepTodo")})`}</span>
        </p>
        <div className="mt-1 text-[13.5px] text-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function LedgerOverviewPage() {
  const { session, supabase, canRead, canManage, settings } = await getLedgerAccess();
  const t = await getT();
  const header = (
    <PageHeader
      eyebrow={t("finance.common.title")}
      title={t("finance.ledger.title")}
      description={t("finance.ledger.home.description")}
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

  const org = session.organizationId;
  const [periods, openings, drafts, posted, readers, staff] = await Promise.all([
    supabase.from("ledger_period").select("id", { count: "exact", head: true }).eq("organization_id", org),
    supabase
      .from("journal_entry")
      .select("id, entry_number, entry_date")
      .eq("organization_id", org)
      .eq("kind", "opening")
      .eq("status", "posted")
      .order("entry_date")
      .limit(1),
    supabase
      .from("journal_entry")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "draft"),
    supabase
      .from("journal_entry")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "posted"),
    canManage
      ? supabase
          .from("ledger_reader")
          .select("user_id, user_profile:user_id(full_name, email)")
          .eq("organization_id", org)
      : Promise.resolve({ data: [] }),
    canManage
      ? supabase
          .from("organization_membership")
          .select("user_id, user_profile:user_id(full_name, email)")
          .eq("organization_id", org)
          .eq("status", "active")
          .eq("role", "staff")
      : Promise.resolve({ data: [] }),
  ]);

  type Person = { user_id: string; user_profile: { full_name: string; email: string } | null };
  const name = (p: Person) => p.user_profile?.full_name || p.user_profile?.email || t("finance.ledger.home.unnamed");
  const readerRows = ((readers.data ?? []) as unknown as Person[]).map((p) => ({ id: p.user_id, name: name(p) }));
  const readerIds = new Set(readerRows.map((r) => r.id));
  const candidates = ((staff.data ?? []) as unknown as Person[])
    .filter((p) => !readerIds.has(p.user_id))
    .map((p) => ({ id: p.user_id, name: name(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const opening = (openings.data ?? [])[0] as { id: string; entry_number: number; entry_date: string } | undefined;
  const approved = Boolean(settings?.chart_approved_on);
  // Sentences with a link inside: the link text is its own key, placed
  // where the translation puts {link}.
  const [chartReviewBefore, chartReviewAfter] = t("finance.ledger.home.chartReview").split("{link}");
  const [openingBefore, openingAfter] = opening
    ? t("finance.ledger.home.openingPosted", { date: opening.entry_date }).split("{link}")
    : ["", ""];

  return (
    <div>
      {header}
      <LedgerTabs />

      <section aria-labelledby="setup-heading" className="card mb-6 p-5">
        <h2 id="setup-heading" className="text-[15px] font-semibold">
          {t("finance.ledger.home.setupHeading")}
        </h2>
        <ol className="mt-2 divide-y divide-line">
          <Step done={approved} t={t} title={t("finance.ledger.home.stepChart")}>
            {approved ? (
              <p>
                {t("finance.ledger.home.chartApproved", {
                  name: settings?.chart_approved_by_name ?? "",
                  date: settings?.chart_approved_on ?? "",
                })}
              </p>
            ) : (
              <>
                <p className="mb-3">
                  {chartReviewBefore}
                  <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/accounts">
                    {t("finance.ledger.home.chartReviewLink")}
                  </Link>
                  {chartReviewAfter}
                </p>
                {canManage ? <ChartApprovalForm today={todayIn(session.timeZone)} /> : null}
              </>
            )}
          </Step>
          <Step done={(periods.count ?? 0) > 0} t={t} title={t("finance.ledger.home.stepPeriods")}>
            <p>
              {(periods.count ?? 0) > 0 ? t("finance.ledger.home.periodCount", { count: periods.count ?? 0 }) : t("finance.ledger.home.noPeriods")}{" "}
              <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/periods">
                {t("finance.ledger.home.managePeriods")}
              </Link>
            </p>
          </Step>
          <Step done={Boolean(opening)} t={t} title={t("finance.ledger.home.stepOpening")}>
            {opening ? (
              <p>
                {openingBefore}
                <Link className="text-brand-fg underline underline-offset-2" href={`/finance/ledger/journal/${opening.id}`}>
                  {t("finance.ledger.entry.numbered", { number: opening.entry_number })}
                </Link>
                {openingAfter}
              </p>
            ) : (
              <p>
                {t("finance.ledger.home.openingHint")}{" "}
                {canManage ? (
                  <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/journal/new?kind=opening">
                    {t("finance.ledger.home.enterOpening")}
                  </Link>
                ) : null}
              </p>
            )}
          </Step>
        </ol>
      </section>

      <section aria-labelledby="summary-heading" className="mb-6 grid gap-3 sm:grid-cols-2">
        <h2 id="summary-heading" className="sr-only">
          {t("finance.ledger.home.summaryHeading")}
        </h2>
        <Link href="/finance/ledger/journal" className="card p-4 hover:bg-surface-soft/60">
          <p className="text-[13px] text-muted">{t("finance.ledger.home.postedEntries")}</p>
          <p className="text-2xl font-semibold">{posted.count ?? 0}</p>
        </Link>
        <Link href="/finance/ledger/journal?status=draft" className="card p-4 hover:bg-surface-soft/60">
          <p className="text-[13px] text-muted">{t("finance.ledger.home.draftsWaiting")}</p>
          <p className="text-2xl font-semibold">{drafts.count ?? 0}</p>
        </Link>
      </section>

      {canManage ? (
        <section aria-labelledby="readers-heading" className="card p-5">
          <h2 id="readers-heading" className="text-[15px] font-semibold">
            {t("finance.ledger.home.readersHeading")}
          </h2>
          <p className="mt-1 mb-3 text-[13.5px] text-muted">
            {t("finance.ledger.home.readersDescription")}
          </p>
          <LedgerReaders readers={readerRows} candidates={candidates} />
        </section>
      ) : null}
    </div>
  );
}
