import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatTile, WeeklyBars } from "@/features/insight/components/charts";
import {
  buildDashboard,
  dashboardTemplates,
  sourcesFor,
  templateFor,
  type DashboardSource,
  type StatTileKey,
  type StatValue,
} from "@/features/insight/dashboards/dashboards";
import { loadDashboardRows } from "@/features/insight/dashboards/dashboards.source";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT } from "@/features/insight/i18n/translate";
import { direction } from "@/features/insight/metrics";
import { requireSession } from "@/lib/auth";
import { getFormatters } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("dashboards.title") };
}
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

/** The source whose emptiness means "you may not see this", per finance tile. */
const ACCESS_SOURCE: Partial<Record<StatTileKey, DashboardSource>> = {
  billsOutstanding: "bills",
  invoicesOutstanding: "invoices",
  giftsThisYear: "gifts",
};

export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireInsightEnabled();
  const session = await requireSession();
  const [params, t, format, client] = await Promise.all([
    searchParams,
    getInsightT(),
    getFormatters(),
    createSupabasePageClient(),
  ]);
  const requested = Array.isArray(params.template) ? params.template[0] : params.template;
  const template = templateFor(requested);
  const now = new Date();
  const { rows, empty, truncated } = await loadDashboardRows(client, sourcesFor(template), now, session.timeZone);
  const data = buildDashboard(template, rows, now, session.timeZone);

  const show = (value: StatValue) =>
    value.kind === "money" ? format.currency(value.cents / 100) : format.number(value.value);
  const week = (start: string) => format.inZone(`${start}T12:00:00Z`, "UTC", { month: "short", day: "numeric" });

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("dashboards.title")} description={t("dashboards.description")} />
      <nav aria-label={t("dashboards.templatesLabel")} className="mb-2 flex flex-wrap gap-1">
        {dashboardTemplates.map((option) => (
          <Link
            key={option.key}
            href={`/insight/dashboards?template=${option.key}`}
            aria-current={option.key === template.key ? "page" : undefined}
            className="rounded-(--radius-sm) border border-line px-3 py-1.5 text-body-sm text-ink hover:bg-surface-soft aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-white"
          >
            {t(`dashboards.templates.${option.key}`)}
          </Link>
        ))}
      </nav>
      <p className="mb-6 text-body-sm text-muted">{t(`dashboards.templateHint.${template.key}`)}</p>
      {truncated ? <p className="mb-4 text-body-sm text-warning-fg">{t("dashboards.truncated")}</p> : null}

      <section aria-labelledby="dash-stats" className="mb-8">
        <h2 id="dash-stats" className="mb-3 text-title font-semibold text-ink">{t("dashboards.statsHeading")}</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {template.stats.map((key) => {
            const value = data.stats[key]!;
            const hidden = ACCESS_SOURCE[key] && empty.has(ACCESS_SOURCE[key]!);
            const overdue = key === "overdueTasks" && value.kind === "count" && value.value > 0;
            return (
              <StatTile
                key={key}
                label={t(`dashboards.stats.${key}`)}
                value={show(value)}
                caption={hidden ? t("dashboards.noAccess") : overdue ? t("dashboards.overdueCaption") : undefined}
                tone={overdue ? "attention" : "neutral"}
              />
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="dash-trends" className="mb-8">
        <h2 id="dash-trends" className="mb-3 text-title font-semibold text-ink">{t("dashboards.trendsHeading")}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {template.trends.map((key) => {
            const buckets = data.trends[key]!;
            const title = t(`dashboards.trends.${key}`);
            const counts = buckets.map((bucket) => bucket.count);
            return (
              <WeeklyBars
                key={key}
                title={title}
                summary={t("dashboards.trendSummary", {
                  title,
                  total: format.number(counts.reduce((sum, value) => sum + value, 0)),
                  latest: format.number(counts[counts.length - 1] ?? 0),
                  direction: t(`dashboards.direction.${direction(counts)}`),
                })}
                buckets={buckets}
                formatWeek={week}
                formatValue={(value) => format.number(value)}
                tableLabel={t("dashboards.showTable")}
                weekHeader={t("dashboards.weekOf")}
                valueHeader={t("dashboards.value")}
              />
            );
          })}
        </div>
      </section>

      {template.spaceTotals ? (
        <section aria-labelledby="dash-spaces">
          <h2 id="dash-spaces" className="mb-1 text-title font-semibold text-ink">{t("dashboards.spacesHeading")}</h2>
          <p className="mb-3 text-body-sm text-muted">{t("dashboards.spacesCaption")}</p>
          <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
            <table className="w-full min-w-[560px] text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">{t("dashboards.columns.program")}</th>
                  {(["projects", "openTasks", "overdueTasks", "completedLast30", "upcomingEvents"] as const).map((column) => (
                    <th key={column} scope="col" className="px-4 py-2 text-right font-medium">
                      {t(`dashboards.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.spaceTotals.map((total) => (
                  <tr key={total.programId ?? "none"} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="px-4 py-2 font-medium text-ink">
                      {total.programId ? (
                        <Link href={`/programs/${total.programId}`} className="text-brand-fg hover:underline">{total.name}</Link>
                      ) : (
                        t("dashboards.noProgram")
                      )}
                    </th>
                    {[total.projects, total.openTasks, total.overdueTasks, total.completedLast30, total.upcomingEvents].map((value, index) => (
                      <td key={index} className="px-4 py-2 text-right tabular-nums text-ink">{format.number(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
