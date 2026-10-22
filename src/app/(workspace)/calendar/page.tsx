import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import {
  AgendaView,
  calendarDateFormats,
  KIND_STYLES,
  WeekView,
  type CalendarItem,
} from "@/features/calendar/components/week-view";
import { getLocale, getT } from "@/lib/i18n/server";
import {
  anchorDay,
  calendarWindow,
  dayAsLocalDate,
  timeOfDayLabel,
  timedItemDay,
  windowInstants,
} from "@/features/calendar/calendar-model";
import { shiftAnchor } from "@/features/lenses/calendar/model";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("calendar.title") };
}
export const dynamic = "force-dynamic";

/**
 * Unified calendar: one read model over distinct domain records (CAL-001).
 * Week is the primary operational view (§10.9); month remains available,
 * and mobile falls back to an agenda list (§11.2).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const formats = calendarDateFormats(locale);
  const view = params.view === "month" ? "month" : "week";

  // Every day here is a YYYY-MM-DD in the workspace's zone. The server runs
  // in UTC, so date-fns on a Date put evening meetings on the next day and
  // moved "today" to tomorrow every evening. A date that is not a day
  // (2026-02-30, or any other text) falls back to today.
  const tz = session.timeZone;
  const today = anchorDay(undefined, tz);
  const anchor = anchorDay(params.date, tz);

  // Server-prepared bounded range (CAL-006).
  const range = calendarWindow(view, anchor);
  const { startIso: rangeStartIso, endIso: rangeEndIso } = windowInstants(range, tz);
  const dateStart = range.from;
  const dateEnd = range.to;

  const supabase = await createSupabasePageClient();

  const [tasksRes, milestonesRes, meetingsRes, eventsRes, followUpsRes, googleRes] =
    await Promise.all([
      supabase
        .from("task")
        .select("id, title, due_at, project_id")
        .gte("due_at", dateStart)
        .lte("due_at", dateEnd)
        .is("archived_at", null)
        .neq("status", "cancelled")
        .limit(300),
      supabase
        .from("milestone")
        .select(
          "id, name, due_date, project_id, completed_at, " +
            "owner:owner_id(full_name)",
        )
        .gte("due_date", dateStart)
        .lte("due_date", dateEnd)
        .limit(100),
      supabase
        .from("meeting")
        .select("id, title, starts_at")
        .gte("starts_at", rangeStartIso)
        .lt("starts_at", rangeEndIso)
        .neq("status", "cancelled")
        .limit(100),
      supabase
        .from("event")
        .select("id, name, starts_at")
        .gte("starts_at", rangeStartIso)
        .lt("starts_at", rangeEndIso)
        .neq("status", "cancelled")
        .limit(100),
      supabase
        .from("crm_follow_up")
        .select("id, title, due_at, crm_organization_id")
        .gte("due_at", dateStart)
        .lte("due_at", dateEnd)
        .eq("status", "open")
        .limit(100),
      supabase
        .from("calendar_event_link")
        .select("id, title, starts_at, html_link")
        .eq("user_id", session.userId)
        // Hub-owned meeting/event links render through their source record.
        // The overlay contains only Calendar-only events, avoiding duplicates.
        .is("meeting_id", null)
        .is("event_id", null)
        .gte("starts_at", rangeStartIso)
        .lt("starts_at", rangeEndIso)
        .limit(100),
    ]);

  // Which projects this viewer may actually reschedule within. Asked once, as
  // a set, rather than per chip: a calendar can hold hundreds of records and a
  // capability check for each would be hundreds of round trips to answer one
  // question. Organization admins manage everything, so they skip the read.
  //
  // This decides whether the control is *offered*. It is not the permission
  // boundary — `rescheduleCalendarItem` writes through RLS and refuses
  // anything this set got wrong — but offering a control that can only fail
  // is its own defect, so the two agree by default.
  const manageableProjects = new Set<string>();
  if (!session.isAdmin) {
    const { data: grants } = await supabase
      .from("project_access_grant")
      .select("project_id, role")
      .eq("user_id", session.userId);
    for (const grant of grants ?? []) {
      if (grant.role === "project_manager") manageableProjects.add(grant.project_id as string);
    }
  }
  const canMove = (projectId: string | null) =>
    session.isAdmin || (projectId !== null && manageableProjects.has(projectId));

  // A timed record sits on its workspace day and shows its workspace time.
  const timed = (startsAt: string) => ({
    date: new Date(startsAt),
    day: timedItemDay(startsAt, tz) ?? startsAt.slice(0, 10),
    timeLabel: timeOfDayLabel(startsAt, tz, locale),
  });

  const items: CalendarItem[] = [
    ...(tasksRes.data ?? []).map((t) => ({
      id: `task-${t.id}`,
      date: dayAsLocalDate(t.due_at as string),
      day: t.due_at as string,
      label: t.title as string,
      kind: "task" as const,
      href: `/my-work?task=${t.id}`,
      timed: false,
      recordId: t.id as string,
      reschedulableDate: canMove((t.project_id as string | null) ?? null)
        ? (t.due_at as string)
        : null,
    })),
    ...((milestonesRes.data ?? []) as unknown as {
      id: string;
      name: string;
      due_date: string;
      project_id: string;
      completed_at: string | null;
      owner: { full_name: string } | null;
    }[]).map((m) => ({
      id: `milestone-${m.id}`,
      date: dayAsLocalDate(m.due_date),
      day: m.due_date,
      label: m.name,
      kind: "milestone" as const,
      href: `/projects/${m.project_id}`,
      timed: false,
      owner: m.owner?.full_name ?? null,
      done: Boolean(m.completed_at),
      recordId: m.id,
      reschedulableDate: canMove(m.project_id) ? m.due_date : null,
    })),
    ...(meetingsRes.data ?? []).map((m) => ({
      id: `meeting-${m.id}`,
      ...timed(m.starts_at as string),
      label: m.title as string,
      kind: "meeting" as const,
      href: `/meetings/${m.id}`,
      timed: true,
    })),
    ...(eventsRes.data ?? []).map((e) => ({
      id: `event-${e.id}`,
      ...timed(e.starts_at as string),
      label: e.name as string,
      kind: "event" as const,
      href: `/events/${e.id}`,
      timed: true,
    })),
    ...(followUpsRes.data ?? []).map((f) => ({
      id: `follow-${f.id}`,
      date: dayAsLocalDate(f.due_at as string),
      day: f.due_at as string,
      label: f.title as string,
      kind: "follow_up" as const,
      href: `/crm/${f.crm_organization_id}`,
      timed: false,
    })),
    ...(googleRes.data ?? []).map((g) => ({
      id: `google-${g.id}`,
      ...timed(g.starts_at as string),
      label: g.title as string,
      kind: "google" as const,
      href: (g.html_link as string | null) || "/calendar",
      timed: true,
    })),
  ];

  const previous = shiftAnchor(view, anchor, -1);
  const next = shiftAnchor(view, anchor, 1);

  const title =
    view === "week"
      ? `${format(dayAsLocalDate(range.from), formats.rangeStart, formats.options)} – ${format(dayAsLocalDate(range.to), formats.rangeEnd, formats.options)}`
      : format(dayAsLocalDate(anchor), formats.monthYear, formats.options);

  const monthDays = view === "month" ? range.days : [];
  const inMonth = (day: string) => day.slice(0, 7) === anchor.slice(0, 7);

  return (
    <div>
      <PageHeader
        eyebrow={t("calendar.eyebrow")}
        title={title}
        description={t("calendar.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t("calendar.viewGroup")}
              className="flex rounded-(--radius-sm) border border-line"
            >
              {(["week", "month"] as const).map((option) => (
                <Link
                  key={option}
                  href={`/calendar?view=${option}&date=${anchor}`}
                  aria-current={view === option ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 text-[13px] font-medium capitalize first:rounded-l-[7px] last:rounded-r-[7px]",
                    view === option
                      ? "bg-brand text-white"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {t(`calendar.views.${option}`)}
                </Link>
              ))}
            </div>
            <nav aria-label={t("calendar.dateNavigation")} className="flex items-center gap-1">
              <Link
                href={`/calendar?view=${view}&date=${previous}`}
                aria-label={t(`calendar.previous.${view}`)}
                className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
              >
                ←
              </Link>
              <Link
                href={`/calendar?view=${view}`}
                className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
              >
                {t("calendar.today")}
              </Link>
              <Link
                href={`/calendar?view=${view}&date=${next}`}
                aria-label={t(`calendar.next.${view}`)}
                className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
              >
                →
              </Link>
            </nav>
          </div>
        }
      />

      {/* Legend — kinds carry text labels, not color alone */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(KIND_STYLES) as CalendarItem["kind"][]).map((kind) => (
          <span
            key={kind}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize",
              KIND_STYLES[kind],
            )}
          >
            {t(`calendar.legend.${kind}`)}
          </span>
        ))}
      </div>

      {/* Mobile: agenda. Desktop: week grid or month grid. */}
      <div className="md:hidden">
        <AgendaView items={items} today={today} locale={locale} />
      </div>
      <div className="hidden md:block">
        {view === "week" ? (
          <WeekView days={range.days} today={today} items={items} locale={locale} />
        ) : (
          <div className="card relative overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse">
              <thead>
                <tr>
                  {monthDays.slice(0, 7).map((day) => format(dayAsLocalDate(day), "EEE", formats.options)).map((day) => (
                    <th
                      key={day}
                      scope="col"
                      className="border-b border-line bg-surface-soft/60 px-2 py-2 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase"
                    >
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: monthDays.length / 7 }).map((_, week) => (
                  <tr key={week}>
                    {monthDays.slice(week * 7, week * 7 + 7).map((day) => {
                      const dayItems = items.filter((item) => item.day === day);
                      return (
                        <td
                          key={day}
                          className={cn(
                            "h-28 border-b border-l border-line p-1.5 align-top first:border-l-0",
                            !inMonth(day) && "bg-surface-soft/40",
                          )}
                        >
                          <p
                            className={cn(
                              "mb-1 text-[12px]",
                              day === today
                                ? "inline-flex size-5.5 items-center justify-center rounded-full bg-brand font-semibold text-white"
                                : inMonth(day)
                                  ? "font-medium"
                                  : "text-muted/60",
                            )}
                          >
                            {Number(day.slice(8))}
                          </p>
                          <ul className="space-y-1">
                            {dayItems.slice(0, 3).map((item) => (
                              <li key={item.id}>
                                <Link
                                  href={item.href}
                                  title={item.label}
                                  className={cn(
                                    "block truncate rounded px-1.5 py-0.5 text-[11px] font-medium hover:opacity-80",
                                    KIND_STYLES[item.kind],
                                  )}
                                >
                                  {item.label}
                                </Link>
                              </li>
                            ))}
                            {dayItems.length > 3 ? (
                              <li className="px-1.5 text-[10.5px] text-muted">
                                {t("calendar.more", { count: dayItems.length - 3 })}
                              </li>
                            ) : null}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
