import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Label, Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/table";
import { CrmTabs } from "@/features/crm/components/crm-tabs";
import { ZeffyMatchActions } from "@/features/crm/components/zeffy-match-actions";
import { zeffyCategoryLabel } from "@/features/crm/labels";
import { getZeffyOverview } from "@/features/crm/services/supporter.queries";
import { requireSession, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { getFormatters, getT } from "@/lib/i18n/server";
import { calendarDateInZone } from "@/lib/time";
import type { MessageKey } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("crm.zeffy.title") };
}
export const dynamic = "force-dynamic";

const PERIODS = ["30", "90", "365"] as const;
type Period = (typeof PERIODS)[number];

/** The calendar date `days` before `date` (YYYY-MM-DD), counting `date` itself. */
function daysBefore(date: string, days: number): string {
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

export default async function ZeffyOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await requireSession();
  if (!session.isStaff) redirect(NO_ACCESS_REDIRECT);
  const params = await searchParams;
  const period: Period = (PERIODS as readonly string[]).includes(params.period ?? "")
    ? (params.period as Period)
    : "30";
  const now = new Date();
  const to = calendarDateInZone(now, session.timeZone) ?? now.toISOString().slice(0, 10);
  const from = daysBefore(to, Number(period));

  const [t, format, data] = await Promise.all([
    getT(),
    getFormatters(),
    getZeffyOverview(session.organizationId, from, to),
  ]);
  const { overview, campaigns, matches } = data;
  const money = overview.money;
  const currency = (money?.currency ?? "cad").toUpperCase();
  const amount = (cents: number, code: string | null = null) =>
    format.currency(cents / 100, (code ?? currency).toUpperCase());
  const connected = overview.connection !== null && overview.connection.status !== "disconnected";

  return (
    <div>
      <PageHeader eyebrow={t("crm.eyebrow")} title={t("crm.zeffy.title")} description={t("crm.zeffy.description")} />
      <CrmTabs active="zeffy" />

      {!connected ? (
        <p role="status" className="mb-6 rounded-(--radius-sm) bg-surface-soft px-3 py-2 text-[13px] text-muted">
          {t("crm.zeffy.notConnected")}
        </p>
      ) : overview.connection?.last_sync_at ? (
        <p className="meta mb-4">
          {t("crm.zeffy.lastSync", { when: format.dateTime(overview.connection.last_sync_at, session.timeZone) })}
        </p>
      ) : null}

      <form method="get" action="/crm/zeffy" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="zeffy-period">{t("crm.zeffy.period")}</Label>
          <Select id="zeffy-period" name="period" defaultValue={period}>
            {PERIODS.map((code) => (
              <option key={code} value={code}>
                {t(`crm.zeffy.periods.${code}` as MessageKey)}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className="inline-flex h-9.5 items-center rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-strong"
        >
          {t("crm.zeffy.show")}
        </button>
      </form>

      <dl className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t("crm.zeffy.supporters")} value={String(overview.supporters)} />
        <Tile label={t("crm.zeffy.newSupporters")} value={String(overview.new_supporters)} />
        <Tile label={t("crm.zeffy.payments")} value={String(overview.payments)} />
        <Tile
          label={t("crm.zeffy.matching")}
          value={String(overview.needs_matching)}
          tone={overview.needs_matching > 0 ? "warning" : undefined}
          href={overview.needs_matching > 0 ? "#zeffy-matching" : undefined}
        />
        {money ? (
          <>
            <Tile label={t("crm.zeffy.raised")} value={amount(money.raised_cents)} />
            <Tile label={t("crm.zeffy.raisedYear")} value={amount(money.raised_year_cents)} />
            <Tile label={t("crm.zeffy.recurringDonors")} value={String(money.recurring_donors)} />
            <Tile label={t("crm.zeffy.monthlyRecurring")} value={amount(money.monthly_recurring_cents)} />
            <Tile label={t("crm.zeffy.lapsed")} value={String(money.lapsed_donors)} />
            <Tile label={t("crm.zeffy.refunded")} value={amount(money.refunded_cents)} />
            <Tile
              label={t("crm.zeffy.disputes")}
              value={String(money.disputes_open)}
              tone={money.disputes_open > 0 ? "danger" : undefined}
            />
          </>
        ) : null}
      </dl>
      {money ? <p className="meta -mt-5 mb-8">{t("crm.zeffy.financeOnly")}</p> : null}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="zeffy-campaigns">
            <h2 id="zeffy-campaigns" className="section-heading mb-3">
              {t("crm.zeffy.campaigns")}
            </h2>
            {campaigns.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.zeffy.campaignsEmpty")}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {campaigns.map((campaign) => {
                  const raised = campaign.raised_cents ?? 0;
                  const goal = campaign.goal_cents ?? 0;
                  const share = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null;
                  return (
                    <li key={campaign.zeffy_id} className="px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">{campaign.title}</p>
                        {campaign.url ? (
                          <a
                            href={campaign.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12.5px] underline hover:text-brand-fg"
                          >
                            {t("crm.zeffy.openInZeffy", { title: campaign.title })}
                          </a>
                        ) : null}
                      </div>
                      <p className="meta">
                        {campaign.category ? zeffyCategoryLabel(campaign.category, t) : null}
                        {campaign.category && campaign.ends_at ? " · " : null}
                        {campaign.ends_at ? format.date(campaign.ends_at, session.timeZone) : null}
                      </p>
                      <p className="mt-1 text-[13px] tabular-nums">
                        {goal > 0
                          ? t("crm.zeffy.ofGoal", {
                              raised: amount(raised, campaign.currency),
                              goal: amount(goal, campaign.currency),
                            })
                          : t("crm.zeffy.raisedOnly", { raised: amount(raised, campaign.currency) })}
                      </p>
                      {share !== null ? (
                        <div
                          role="progressbar"
                          aria-label={campaign.title}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={share}
                          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-soft"
                        >
                          <div className="h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="zeffy-attendance">
            <h2 id="zeffy-attendance" className="section-heading mb-3">
              {t("crm.zeffy.attendance")}
            </h2>
            {overview.attendance.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.zeffy.attendanceEmpty")}</p>
            ) : (
              <DataTable minWidth="420px">
                <tbody className="divide-y divide-line">
                  {overview.attendance.map((row) => (
                    <tr key={row.campaign_id ?? row.title ?? ""}>
                      <th scope="row" className="px-3 py-2.5 text-left font-medium">
                        {row.title ?? "—"}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {t(row.tickets === 1 ? "crm.zeffy.ticketsOne" : "crm.zeffy.tickets", { count: row.tickets })}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-muted">
                        {t(row.buyers === 1 ? "crm.zeffy.buyersOne" : "crm.zeffy.buyers", { count: row.buyers })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </section>

          {money && money.by_category.length > 0 ? (
            <section aria-labelledby="zeffy-categories">
              <h2 id="zeffy-categories" className="section-heading mb-3">
                {t("crm.zeffy.byCategory")}
              </h2>
              <dl className="card divide-y divide-line">
                {money.by_category.map((row) => (
                  <div key={row.category} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                    <dt>{zeffyCategoryLabel(row.category, t)}</dt>
                    <dd className="tabular-nums">{amount(row.cents)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        <aside>
          <section id="zeffy-matching" aria-labelledby="zeffy-matching-heading" className="scroll-mt-20">
            <h2 id="zeffy-matching-heading" className="section-heading mb-1">
              {t("crm.zeffy.matching")}
            </h2>
            <p className="meta mb-3">{t("crm.zeffy.matchingHelp")}</p>
            {matches.length === 0 ? (
              <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("crm.zeffy.matchingEmpty")}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {matches.map((match) => (
                  <li key={match.id} className="px-4 py-3">
                    <p className="font-medium">{match.full_name}</p>
                    {match.email ? <p className="meta">{match.email}</p> : null}
                    <ZeffyMatchActions matchId={match.id} candidates={match.candidates} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone?: "warning" | "danger";
  href?: string;
}) {
  const figure = (
    <dd
      className={
        tone === "danger"
          ? "text-[20px] font-semibold text-danger-fg tabular-nums"
          : tone === "warning"
            ? "text-[20px] font-semibold text-warning-fg tabular-nums"
            : "text-[20px] font-semibold tabular-nums"
      }
    >
      {href ? (
        <Link href={href} className="hover:underline">
          {value}
        </Link>
      ) : (
        value
      )}
    </dd>
  );
  return (
    <div className="card px-4 py-3">
      <dt className="meta">{label}</dt>
      {figure}
    </div>
  );
}
