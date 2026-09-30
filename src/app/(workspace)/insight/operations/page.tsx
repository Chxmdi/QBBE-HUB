import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatTile, WeeklyBars } from "@/features/insight/components/charts";
import { GoalTile } from "@/features/insight/components/goal-tile";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT, type InsightKey } from "@/features/insight/i18n/translate";
import { direction } from "@/features/insight/metrics";
import {
  goalTrajectory,
  LATENESS_BANDS,
  openLoadByWeek,
  overduePatterns,
  workloadByPerson,
} from "@/features/insight/operations/operations";
import { loadGoals, loadOperations } from "@/features/insight/operations/operations.source";
import { requireSession } from "@/lib/auth";
import { getFormatters } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("operations.title") };
}
export const dynamic = "force-dynamic";

const th = "whitespace-nowrap px-4 py-2 font-medium";
const td = "px-4 py-2 text-right tabular-nums text-ink";

export default async function OperationsPage() {
  await requireInsightEnabled();
  const session = await requireSession();
  const [t, format, client] = await Promise.all([getInsightT(), getFormatters(), createSupabasePageClient()]);
  const now = new Date();
  const [ops, goals] = await Promise.all([loadOperations(client, now, session.timeZone), loadGoals(client)]);

  const load = openLoadByWeek(ops.tasks, now, session.timeZone);
  const people = workloadByPerson(ops.tasks, now, session.timeZone);
  const overdue = overduePatterns(ops.tasks, now, session.timeZone);
  const trajectories = goals.metrics.map((metric) => goalTrajectory(metric, goals.measurements));

  const week = (start: string) => format.inZone(`${start}T12:00:00Z`, "UTC", { month: "short", day: "numeric" });
  const n = (value: number) => format.number(value);
  const loadCounts = load.map((bucket) => bucket.count);
  const slipCounts = overdue.slippedByWeek.map((bucket) => bucket.count);
  const priorityLabel = (priority: string) => {
    const key = `operations.priorities.${priority}` as InsightKey;
    const label = t(key);
    return label === key ? priority : label;
  };

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("operations.title")} description={t("operations.description")} />
      {ops.truncated ? <p className="mb-4 text-body-sm text-warning-fg">{t("operations.truncated")}</p> : null}

      <section aria-labelledby="ops-workload" className="mb-8">
        <h2 id="ops-workload" className="mb-3 text-title font-semibold text-ink">{t("operations.workloadHeading")}</h2>
        <div className="grid grid-cols-1 gap-4">
          <WeeklyBars
            title={t("operations.loadTrend")}
            summary={t("operations.loadSummary", {
              latest: n(loadCounts.at(-1) ?? 0),
              first: n(loadCounts[0] ?? 0),
              direction: t(`dashboards.direction.${direction(loadCounts)}`),
            })}
            buckets={load}
            formatWeek={week}
            formatValue={n}
            tableLabel={t("dashboards.showTable")}
            weekHeader={t("dashboards.weekOf")}
            valueHeader={t("dashboards.value")}
          />
          <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
            {people.length ? (
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className={th}>{t("operations.columns.person")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("operations.columns.open")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("operations.columns.overdue")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("operations.columns.finished")}</th>
                    <th scope="col" className={th}>{t("operations.columns.trend")}</th>
                  </tr>
                </thead>
                <tbody>
                  {people.slice(0, 15).map((person) => (
                    <tr key={person.personId} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="whitespace-nowrap px-4 py-2 font-medium text-ink">
                        <Link href={`/people/${person.personId}`} className="text-brand-fg hover:underline">
                          {ops.people.get(person.personId) || t("operations.unassigned")}
                        </Link>
                      </th>
                      <td className={td}>{n(person.open)}</td>
                      <td className={`${td} ${person.overdue ? "font-semibold text-danger-fg" : ""}`}>{n(person.overdue)}</td>
                      <td className={td}>{n(person.finishedLast28)}</td>
                      <td className="px-4 py-2 text-muted">{t(`operations.trend.${person.trend}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-4 text-body-sm text-muted">{t("operations.noWork")}</p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="ops-overdue" className="mb-8">
        <h2 id="ops-overdue" className="mb-3 text-title font-semibold text-ink">{t("operations.overdueHeading")}</h2>
        <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label={t("operations.overdueTotal")} value={n(overdue.total)} tone={overdue.total ? "attention" : "neutral"} />
          {LATENESS_BANDS.map((band) => (
            <StatTile key={band} label={t(`operations.lateness.${band}`)} value={n(overdue.byLateness[band])} />
          ))}
          <StatTile
            label={t("operations.lateShare")}
            value={t("operations.lateShareValue", { late: n(overdue.finishedLate), finished: n(overdue.finished) })}
          />
        </dl>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <WeeklyBars
              title={t("operations.slippedTrend")}
              summary={t("operations.slippedSummary", {
                total: n(slipCounts.reduce((sum, v) => sum + v, 0)),
                latest: n(slipCounts.at(-1) ?? 0),
                direction: t(`dashboards.direction.${direction(slipCounts)}`),
              })}
              buckets={overdue.slippedByWeek}
              formatWeek={week}
              formatValue={n}
              tableLabel={t("dashboards.showTable")}
              weekHeader={t("dashboards.weekOf")}
              valueHeader={t("dashboards.value")}
            />
          </div>
          <div className="space-y-4">
          <div className="rounded-(--radius-md) border border-line bg-surface">
            <h3 className="px-4 pt-3 text-body font-semibold text-ink">{t("operations.byPriority")}</h3>
            {overdue.byPriority.length ? (
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className={th}>{t("operations.columns.priority")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("operations.columns.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.byPriority.map((row) => (
                    <tr key={row.priority} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium text-ink">{priorityLabel(row.priority)}</th>
                      <td className={td}>{n(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-3 text-body-sm text-muted">{t("operations.none")}</p>
            )}
          </div>
          <div className="rounded-(--radius-md) border border-line bg-surface">
            <h3 className="px-4 pt-3 text-body font-semibold text-ink">{t("operations.byProject")}</h3>
            {overdue.byProject.length ? (
              <table className="w-full text-left text-body-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className={th}>{t("operations.columns.project")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("operations.columns.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.byProject.map((row) => (
                    <tr key={row.projectId ?? "none"} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">
                        {row.projectId && ops.projects.has(row.projectId) ? (
                          <Link href={`/projects/${row.projectId}`} className="text-brand-fg hover:underline">{ops.projects.get(row.projectId)}</Link>
                        ) : (
                          <span className="text-ink">{t("operations.noProject")}</span>
                        )}
                      </th>
                      <td className={td}>{n(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-3 text-body-sm text-muted">{t("operations.none")}</p>
            )}
          </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="ops-goals">
        <h2 id="ops-goals" className="mb-1 text-title font-semibold text-ink">{t("operations.goalsHeading")}</h2>
        <p className="mb-3 text-body-sm text-muted">{t("operations.goalsCaption")}</p>
        {trajectories.length ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trajectories.map((trajectory) => (
              <GoalTile key={trajectory.metric.id} trajectory={trajectory} t={t} format={format} />
            ))}
          </div>
        ) : (
          <p className="text-body-sm text-muted">{t("operations.noGoals")}</p>
        )}
      </section>
    </div>
  );
}
