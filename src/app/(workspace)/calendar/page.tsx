import type { Metadata } from "next";
import Link from "next/link";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { PageHeader } from "@/components/shared/page-header";
import {
  AgendaView,
  KIND_STYLES,
  WeekView,
  type CalendarItem,
} from "@/features/calendar/components/week-view";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Calendar" };
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
  const view = params.view === "month" ? "month" : "week";

  const anchor = params.date
    ? parse(params.date, "yyyy-MM-dd", new Date())
    : new Date();

  // Server-prepared bounded range (CAL-006).
  const rangeStartDate =
    view === "week"
      ? startOfWeek(anchor, { weekStartsOn: 0 })
      : startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
  const rangeEndDate =
    view === "week"
      ? endOfWeek(anchor, { weekStartsOn: 0 })
      : endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });

  const supabase = await createSupabaseServerClient();
  const rangeStartIso = rangeStartDate.toISOString();
  const rangeEndIso = rangeEndDate.toISOString();
  const dateStart = format(rangeStartDate, "yyyy-MM-dd");
  const dateEnd = format(rangeEndDate, "yyyy-MM-dd");

  const [tasksRes, milestonesRes, meetingsRes, eventsRes, followUpsRes, googleRes] =
    await Promise.all([
      supabase
        .from("task")
        .select("id, title, due_at")
        .gte("due_at", dateStart)
        .lte("due_at", dateEnd)
        .is("archived_at", null)
        .neq("status", "cancelled")
        .limit(300),
      supabase
        .from("milestone")
        .select("id, name, due_date, project_id")
        .gte("due_date", dateStart)
        .lte("due_date", dateEnd)
        .limit(100),
      supabase
        .from("meeting")
        .select("id, title, starts_at")
        .gte("starts_at", rangeStartIso)
        .lte("starts_at", rangeEndIso)
        .neq("status", "cancelled")
        .limit(100),
      supabase
        .from("event")
        .select("id, name, starts_at")
        .gte("starts_at", rangeStartIso)
        .lte("starts_at", rangeEndIso)
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
        .gte("starts_at", rangeStartIso)
        .lte("starts_at", rangeEndIso)
        .limit(100),
    ]);

  const items: CalendarItem[] = [
    ...(tasksRes.data ?? []).map((t) => ({
      id: `task-${t.id}`,
      date: parse(t.due_at as string, "yyyy-MM-dd", new Date()),
      label: t.title as string,
      kind: "task" as const,
      href: `/my-work?task=${t.id}`,
      timed: false,
    })),
    ...(milestonesRes.data ?? []).map((m) => ({
      id: `milestone-${m.id}`,
      date: parse(m.due_date as string, "yyyy-MM-dd", new Date()),
      label: m.name as string,
      kind: "milestone" as const,
      href: `/projects/${m.project_id}`,
      timed: false,
    })),
    ...(meetingsRes.data ?? []).map((m) => ({
      id: `meeting-${m.id}`,
      date: new Date(m.starts_at as string),
      label: m.title as string,
      kind: "meeting" as const,
      href: `/meetings/${m.id}`,
      timed: true,
    })),
    ...(eventsRes.data ?? []).map((e) => ({
      id: `event-${e.id}`,
      date: new Date(e.starts_at as string),
      label: e.name as string,
      kind: "event" as const,
      href: `/events/${e.id}`,
      timed: true,
    })),
    ...(followUpsRes.data ?? []).map((f) => ({
      id: `follow-${f.id}`,
      date: parse(f.due_at as string, "yyyy-MM-dd", new Date()),
      label: f.title as string,
      kind: "follow_up" as const,
      href: `/crm/${f.crm_organization_id}`,
      timed: false,
    })),
    ...(googleRes.data ?? []).map((g) => ({
      id: `google-${g.id}`,
      date: new Date(g.starts_at as string),
      label: g.title as string,
      kind: "google" as const,
      href: (g.html_link as string | null) || "/calendar",
      timed: true,
    })),
  ];

  const previous = format(
    view === "week" ? addWeeks(anchor, -1) : addMonths(anchor, -1),
    "yyyy-MM-dd",
  );
  const next = format(
    view === "week" ? addWeeks(anchor, 1) : addMonths(anchor, 1),
    "yyyy-MM-dd",
  );

  const title =
    view === "week"
      ? `${format(rangeStartDate, "MMM d")} – ${format(rangeEndDate, "MMM d, yyyy")}`
      : format(anchor, "MMMM yyyy");

  const monthDays =
    view === "month"
      ? eachDayOfInterval({ start: rangeStartDate, end: rangeEndDate })
      : [];

  return (
    <div>
      <PageHeader
        eyebrow="Schedule"
        title={title}
        description="Tasks, milestones, meetings, events, and CRM follow-ups on one calendar."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Calendar view"
              className="flex rounded-(--radius-sm) border border-line"
            >
              {(["week", "month"] as const).map((option) => (
                <Link
                  key={option}
                  href={`/calendar?view=${option}&date=${format(anchor, "yyyy-MM-dd")}`}
                  aria-current={view === option ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 text-[13px] font-medium capitalize first:rounded-l-[7px] last:rounded-r-[7px]",
                    view === option
                      ? "bg-brand text-white"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {option}
                </Link>
              ))}
            </div>
            <nav aria-label="Date navigation" className="flex items-center gap-1">
              <Link
                href={`/calendar?view=${view}&date=${previous}`}
                aria-label={`Previous ${view}`}
                className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
              >
                ←
              </Link>
              <Link
                href={`/calendar?view=${view}`}
                className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
              >
                Today
              </Link>
              <Link
                href={`/calendar?view=${view}&date=${next}`}
                aria-label={`Next ${view}`}
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
            {kind.replace(/_/g, "-")}
          </span>
        ))}
      </div>

      {/* Mobile: agenda. Desktop: week grid or month grid. */}
      <div className="md:hidden">
        <AgendaView items={items} />
      </div>
      <div className="hidden md:block">
        {view === "week" ? (
          <WeekView anchor={anchor} items={items} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse">
              <thead>
                <tr>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
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
                      const dayItems = items.filter((item) =>
                        isSameDay(item.date, day),
                      );
                      return (
                        <td
                          key={day.toISOString()}
                          className={cn(
                            "h-28 border-b border-l border-line p-1.5 align-top first:border-l-0",
                            !isSameMonth(day, anchor) && "bg-surface-soft/40",
                          )}
                        >
                          <p
                            className={cn(
                              "mb-1 text-[12px]",
                              isToday(day)
                                ? "inline-flex size-5.5 items-center justify-center rounded-full bg-brand font-semibold text-white"
                                : isSameMonth(day, anchor)
                                  ? "font-medium"
                                  : "text-muted/60",
                            )}
                          >
                            {format(day, "d")}
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
                                +{dayItems.length - 3} more
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
