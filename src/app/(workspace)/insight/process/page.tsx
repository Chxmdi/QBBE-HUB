import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { StatTile } from "@/features/insight/components/charts";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT, type InsightKey, type InsightT } from "@/features/insight/i18n/translate";
import { approvalWaits, bottleneck, timeInStatus, turnaround } from "@/features/insight/process/process";
import { loadProcessData, WINDOW_DAYS, type WindowDays } from "@/features/insight/process/process.source";
import { requireSession } from "@/lib/auth";
import { getFormatters } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("process.title") };
}
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const TURNAROUND_TYPES = ["task", "risk", "approval"] as const;

function statusLabel(t: InsightT, status: string): string {
  const key = `process.statuses.${status}` as InsightKey;
  const label = t(key);
  return label === key ? status : label;
}

const th = "whitespace-nowrap px-4 py-2 font-medium";
const td = "px-4 py-2 text-right tabular-nums text-ink";

export default async function ProcessPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireInsightEnabled();
  await requireSession();
  const [params, t, format, client] = await Promise.all([
    searchParams,
    getInsightT(),
    getFormatters(),
    createSupabasePageClient(),
  ]);
  const requested = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const days: WindowDays = (WINDOW_DAYS as readonly number[]).includes(requested) ? (requested as WindowDays) : 90;
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const data = await loadProcessData(client, since);

  const stats = timeInStatus(data.histories, now, since);
  const worst = bottleneck(stats);
  const turnarounds = turnaround(data.turnaround, TURNAROUND_TYPES);
  const approvals = approvalWaits(data.approvalItems, data.approvalEvents, now);

  const duration = (hours: number | null) => {
    if (hours === null) return t("process.none");
    return hours < 48
      ? t("process.hours", { count: format.number(Math.round(hours)) })
      : t("process.days", { count: format.number(hours / 24, { maximumFractionDigits: 1 }) });
  };
  // A bar per row, scaled to the longest average; the number beside it is the data.
  const longest = Math.max(1, ...stats.map((stat) => stat.averageHours));

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("process.title")} description={t("process.description")} />
      <nav aria-label={t("process.windowLabel")} className="mb-6 flex flex-wrap gap-1">
        {WINDOW_DAYS.map((option) => (
          <Link
            key={option}
            href={`/insight/process?days=${option}`}
            aria-current={option === days ? "page" : undefined}
            className="rounded-(--radius-sm) border border-line px-3 py-1.5 text-body-sm text-ink hover:bg-surface-soft aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-white"
          >
            {t("process.window", { days: option })}
          </Link>
        ))}
      </nav>
      {data.truncated ? <p className="mb-4 text-body-sm text-warning-fg">{t("process.truncated")}</p> : null}

      <section aria-labelledby="process-status" className="mb-8">
        <h2 id="process-status" className="mb-1 text-title font-semibold text-ink">{t("process.statusHeading")}</h2>
        <p className="mb-3 text-body-sm text-muted">{t("process.statusCaption")}</p>
        <p className="mb-3 rounded-(--radius-md) border border-line bg-surface-soft px-4 py-3 text-body-sm text-ink" role="status">
          {worst
            ? t("process.bottleneck", {
                status: statusLabel(t, worst.status),
                average: duration(worst.averageHours),
                current: format.number(worst.current),
              })
            : t("process.noBottleneck")}
        </p>
        {stats.length ? (
          <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className={th}>{t("process.columns.status")}</th>
                  <th scope="col" className={`${th} w-2/5`}>{t("process.columns.average")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.median")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.visits")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.current")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.longest")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => (
                  <tr key={stat.status} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="whitespace-nowrap px-4 py-2 font-medium text-ink">{statusLabel(t, stat.status)}</th>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-2 rounded-full bg-chart-primary" style={{ width: `${Math.max((stat.averageHours / longest) * 70, 2)}%` }} />
                        <span className="tabular-nums text-ink">{duration(stat.averageHours)}</span>
                      </div>
                    </td>
                    <td className={td}>{duration(stat.medianHours)}</td>
                    <td className={td}>{format.number(stat.visits)}</td>
                    <td className={td}>{format.number(stat.current)}</td>
                    <td className={td}>{stat.current ? duration(stat.longestCurrentHours) : t("process.none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-body-sm text-muted">{t("process.noData")}</p>
        )}
      </section>

      <section aria-labelledby="process-turnaround" className="mb-8">
        <h2 id="process-turnaround" className="mb-1 text-title font-semibold text-ink">{t("process.turnaroundHeading")}</h2>
        <p className="mb-3 text-body-sm text-muted">{t("process.turnaroundCaption")}</p>
        <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className={th}>{t("process.columns.type")}</th>
                <th scope="col" className={`${th} text-right`}>{t("process.columns.averageTime")}</th>
                <th scope="col" className={`${th} text-right`}>{t("process.columns.typicalTime")}</th>
                <th scope="col" className={`${th} text-right`}>{t("process.columns.finished")}</th>
                <th scope="col" className={`${th} text-right`}>{t("process.columns.open")}</th>
              </tr>
            </thead>
            <tbody>
              {turnarounds.map((row) => (
                <tr key={row.type} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="px-4 py-2 font-medium text-ink">{t(`process.types.${row.type as (typeof TURNAROUND_TYPES)[number]}`)}</th>
                  <td className={td}>{duration(row.averageHours)}</td>
                  <td className={td}>{duration(row.medianHours)}</td>
                  <td className={td}>{format.number(row.finished)}</td>
                  <td className={td}>{format.number(row.open)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="process-approvals">
        <h2 id="process-approvals" className="mb-1 text-title font-semibold text-ink">{t("process.approvalsHeading")}</h2>
        <p className="mb-3 text-body-sm text-muted">{t("process.approvalsCaption")}</p>
        <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label={t("process.averageWait")} value={duration(approvals.averageHours)} />
          <StatTile label={t("process.medianWait")} value={duration(approvals.medianHours)} />
          <StatTile label={t("process.pendingNow")} value={format.number(approvals.waiting.length)} />
        </dl>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className={th}>{t("process.columns.step")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.decisions")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.averageWait")}</th>
                </tr>
              </thead>
              <tbody>
                {approvals.byStep.length ? (
                  approvals.byStep.map((row) => (
                    <tr key={row.step} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium text-ink">{t("process.stepLabel", { step: row.step })}</th>
                      <td className={td}>{format.number(row.decisions)}</td>
                      <td className={td}>{duration(row.averageHours)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-muted">{t("process.noData")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className={th}>{t("process.columns.item")}</th>
                  <th scope="col" className={`${th} text-right`}>{t("process.columns.waiting")}</th>
                </tr>
              </thead>
              <tbody>
                {approvals.waiting.length ? (
                  approvals.waiting.slice(0, 8).map((row) => (
                    <tr key={row.id} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">
                        <Link href={`/approvals?item=${row.id}`} className="text-brand-fg hover:underline">{row.title}</Link>
                      </th>
                      <td className={td}>{duration(row.hours)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-muted">{t("process.noData")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
