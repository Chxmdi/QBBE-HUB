import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { AgendaView, WeekView } from "@/features/calendar/components/week-view";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { reportError } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarDateInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { localized } from "@/lib/query/catalog";
import { loadCatalog, runLensAll } from "@/lib/query/run";
import type { LensSpec } from "@/lib/query/spec";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { getLens } from "@/features/lenses/services/lens-store.queries";
import { OPEN_STATUSES } from "@/features/tasks/filters";
import {
  CALENDAR_VIEWS,
  calendarRange,
  calendarSpec,
  isIsoDay,
  monthDays,
  rowsToItems,
  shiftAnchor,
  type CalendarView,
  type LensCalendarItem,
} from "@/features/lenses/calendar/model";
import { MonthGrid } from "@/features/lenses/calendar/month-grid";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("calendar.title") };
}
export const dynamic = "force-dynamic";

/**
 * The calendar lens (V1-1), behind wos_lenses. `?lens=<id>` shows a saved
 * lens's tasks on their dates; without it, open tasks. `date` picks the date
 * property, `view` the month, week or 30-day agenda, `at` the anchor day.
 */
export default async function CalendarLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const [t, locale] = await Promise.all([getLensT(), getLocale()]);
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const supabase = await createSupabaseServerClient();

  const today = calendarDateInZone(new Date(), session.timeZone) ?? new Date().toISOString().slice(0, 10);
  const view: CalendarView = (CALENDAR_VIEWS as readonly string[]).includes(one(params.view) ?? "") ? (one(params.view) as CalendarView) : "month";
  const anchor = isIsoDay(one(params.at)) ? one(params.at)! : today;
  const lens = one(params.lens) ? await getLens(session.userId, one(params.lens)!) : null;

  let items: LensCalendarItem[] = [];
  let failed = false;
  let dateOptions: { key: string; label: string }[] = [];
  let dateProperty = "due";
  try {
    const catalog = await loadCatalog(supabase);
    const task = catalog.task;
    dateOptions = task.properties.filter((p) => p.kind === "date" && !p.timestamp).map((p) => ({ key: p.key, label: localized(p.name, locale) }));
    const requested = one(params.date);
    dateProperty = dateOptions.some((o) => o.key === requested) ? requested! : "due";
    const base: Partial<LensSpec> & { type: string } =
      lens && lens.typeKey === "task"
        ? (lens.spec as LensSpec)
        : { version: 1, type: "task", where: { and: [{ property: "status", operator: "is_any_of", value: [...OPEN_STATUSES, "completed"] }] } };
    const range = calendarRange(view, anchor);
    const result = await runLensAll(supabase, calendarSpec(base, dateProperty, range), { timeZone: session.timeZone, maxRows: 3000 });
    const { data: editable, error } = await supabase.rpc("lens_editable", { p_ids: result.rows.slice(0, 500).map((r) => r.id) });
    if (error) reportError(error, { lens: "calendar", step: "editable" });
    items = rowsToItems(result.rows, "task", dateProperty, new Set((editable as string[] | null) ?? []));
  } catch (error) {
    reportError(error, { lens: "calendar" });
    failed = true;
  }

  const href = (next: Partial<{ view: string; at: string; date: string }>) => {
    const q = new URLSearchParams({
      view: next.view ?? view,
      at: next.at ?? anchor,
      date: next.date ?? dateProperty,
      ...(lens ? { lens: lens.id } : {}),
    });
    return `/lenses/calendar?${q.toString()}`;
  };
  const link = "rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft";

  return (
    <div>
      <PageHeader
        eyebrow={lens?.name ?? t("types.task")}
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("calendar.view")} className="flex rounded-(--radius-sm) border border-line">
              {CALENDAR_VIEWS.map((option) => (
                <Link
                  key={option}
                  href={href({ view: option })}
                  aria-current={view === option ? "page" : undefined}
                  className={cn("px-3 py-1.5 text-[13px] font-medium", view === option ? "bg-brand text-white" : "text-muted hover:text-ink")}
                >
                  {t(`calendar.views.${option}`)}
                </Link>
              ))}
            </div>
            <nav aria-label={t("calendar.navigation")} className="flex items-center gap-1">
              <Link href={href({ at: shiftAnchor(view, anchor, -1) })} className={link}>
                {t("calendar.previous")}
              </Link>
              <Link href={href({ at: today })} className={link}>
                {t("calendar.today")}
              </Link>
              <Link href={href({ at: shiftAnchor(view, anchor, 1) })} className={link}>
                {t("calendar.next")}
              </Link>
            </nav>
          </div>
        }
      />
      <nav aria-label={t("calendar.dateProperty")} className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="font-medium text-ink">{t("calendar.dateProperty")}</span>
        {dateOptions.map((o) => (
          <Link
            key={o.key}
            href={href({ date: o.key })}
            aria-current={o.key === dateProperty ? "true" : undefined}
            className={cn("rounded-full border px-3 py-1", o.key === dateProperty ? "border-brand bg-brand-soft text-brand-fg" : "border-line text-muted hover:text-ink")}
          >
            {o.label}
          </Link>
        ))}
      </nav>
      {lens && lens.typeKey !== "task" ? <p role="note" className="mb-3 text-[13px] text-muted">{t("calendar.onlyTasks")}</p> : null}
      {failed ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {t("common.loadFailed")}
        </p>
      ) : view === "month" ? (
        <MonthGrid days={monthDays(anchor)} month={anchor.slice(0, 7)} items={items} locale={locale} today={today} t={t} />
      ) : view === "week" ? (
        <WeekView anchor={new Date(`${anchor}T12:00:00Z`)} items={items} locale={locale} />
      ) : (
        <AgendaView items={items} locale={locale} />
      )}
    </div>
  );
}
