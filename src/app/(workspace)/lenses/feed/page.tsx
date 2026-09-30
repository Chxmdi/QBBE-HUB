import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { intlLocale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { reportError } from "@/lib/observability";
import { relativeTime } from "@/lib/utils";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { loadViewLens, type ViewLens } from "@/features/lenses/cards/load";
import { groupByDay, recordHref } from "@/features/lenses/cards/cards";
import { RecordFacts } from "@/features/lenses/cards/record-facts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("feed.title") };
}
export const dynamic = "force-dynamic";

const PAGE = 40;

/**
 * The feed lens (V1-4), behind wos_lenses: a lens's records, most recently
 * changed first, grouped by day. `?lens=<id>` or `?type=`, `?page=`.
 */
export default async function FeedLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const [t, locale] = await Promise.all([getLensT(), getLocale()]);
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Math.min(Math.max(Number.parseInt(one(params.page) ?? "1", 10) || 1, 1), 250);

  let view: ViewLens | null = null;
  try {
    view = await loadViewLens({
      viewerId: session.userId,
      timeZone: session.timeZone,
      lensId: one(params.lens),
      type: one(params.type),
      order: "recent",
      limit: PAGE,
      offset: (page - 1) * PAGE,
    });
  } catch (error) {
    reportError(error, { lens: "feed" });
  }

  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${day}T12:00:00Z`),
    );
  const href = (n: number) => {
    const q = new URLSearchParams({ ...(view?.lens ? { lens: view.lens.id } : { type: view?.type ?? "task" }), page: String(n) });
    return `/lenses/feed?${q.toString()}`;
  };
  const edited = (row: ViewLens["result"]["rows"][number]) => (typeof row.values.edited_time === "string" ? row.values.edited_time : null);

  return (
    <div>
      <PageHeader eyebrow={view?.lens?.name ?? (view ? t(`types.${view.type}` as "types.task") : undefined)} title={t("feed.title")} description={t("feed.description")} />
      {!view ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">{t("common.loadFailed")}</p>
      ) : view.result.rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("common.empty")}</p>
      ) : (
        <section aria-label={t("feed.stream")}>
          <ol className="space-y-6">
            {groupByDay(view.result.rows, edited, session.timeZone).map((group) => (
              <li key={group.day}>
                <h2 className="mb-2 text-[13px] font-semibold capitalize text-ink">{group.day ? dayLabel(group.day) : ""}</h2>
                <ol className="card divide-y divide-line">
                  {group.items.map((row) => {
                    const when = edited(row);
                    const created = typeof row.values.created_time === "string" ? row.values.created_time : null;
                    const isNew = when && created && Math.abs(Date.parse(when) - Date.parse(created)) < 60_000;
                    return (
                      <li key={row.id} data-feed-item={row.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                        <div className="min-w-0 flex-1 basis-64">
                          <Link href={recordHref(view.type, row.id)} className="text-[14px] font-semibold text-ink hover:text-brand-fg">
                            {row.title}
                          </Link>
                          {when ? (
                            <p className="meta">
                              <time dateTime={when}>{t(isNew ? "feed.created" : "feed.updated", { when: relativeTime(when, locale) })}</time>
                            </p>
                          ) : null}
                        </div>
                        <div className="w-full sm:w-72">
                          <RecordFacts row={row} facts={view.facts} locale={locale} timeZone={session.timeZone} />
                        </div>
                        <Badge tone="neutral">{t(`types.${view.type}` as "types.task")}</Badge>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
          <nav aria-label={t("feed.stream")} className="mt-4 flex gap-4 text-[13px] font-medium">
            {page > 1 ? <Link className="text-brand-fg hover:underline" href={href(page - 1)}>{t("feed.newer")}</Link> : null}
            {page * PAGE < view.result.total ? <Link className="text-brand-fg hover:underline" href={href(page + 1)}>{t("feed.older")}</Link> : null}
          </nav>
        </section>
      )}
    </div>
  );
}
