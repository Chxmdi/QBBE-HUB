import type { Metadata } from "next";
import Link from "next/link";
import {
  addMonths,
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
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

interface CalendarItem {
  id: string;
  date: Date;
  label: string;
  kind: "task" | "milestone" | "meeting" | "event" | "follow_up";
  href: string;
}

const KIND_STYLES: Record<CalendarItem["kind"], string> = {
  task: "bg-brand-soft text-brand dark:text-[#f2b8c8]",
  milestone: "bg-accent/20 text-[#7a5f1a] dark:text-accent",
  meeting: "bg-info/12 text-info",
  event: "bg-success/12 text-success",
  follow_up: "bg-warning/12 text-warning",
};

/** Unified calendar: one read model over distinct domain records (CAL-001). */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  const current = params.month
    ? parse(params.month, "yyyy-MM", new Date())
    : new Date();
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const supabase = await createSupabaseServerClient();
  const rangeStart = gridStart.toISOString();
  const rangeEnd = gridEnd.toISOString();
  const dateStart = format(gridStart, "yyyy-MM-dd");
  const dateEnd = format(gridEnd, "yyyy-MM-dd");

  const [tasksRes, milestonesRes, meetingsRes, eventsRes, followUpsRes] =
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
        .gte("starts_at", rangeStart)
        .lte("starts_at", rangeEnd)
        .neq("status", "cancelled")
        .limit(100),
      supabase
        .from("event")
        .select("id, name, starts_at")
        .gte("starts_at", rangeStart)
        .lte("starts_at", rangeEnd)
        .neq("status", "cancelled")
        .limit(100),
      supabase
        .from("crm_follow_up")
        .select("id, title, due_at, crm_organization_id")
        .gte("due_at", dateStart)
        .lte("due_at", dateEnd)
        .eq("status", "open")
        .limit(100),
    ]);

  const items: CalendarItem[] = [
    ...(tasksRes.data ?? []).map((t) => ({
      id: `task-${t.id}`,
      date: parse(t.due_at as string, "yyyy-MM-dd", new Date()),
      label: t.title as string,
      kind: "task" as const,
      href: "/my-work",
    })),
    ...(milestonesRes.data ?? []).map((m) => ({
      id: `milestone-${m.id}`,
      date: parse(m.due_date as string, "yyyy-MM-dd", new Date()),
      label: m.name as string,
      kind: "milestone" as const,
      href: `/projects/${m.project_id}`,
    })),
    ...(meetingsRes.data ?? []).map((m) => ({
      id: `meeting-${m.id}`,
      date: new Date(m.starts_at as string),
      label: m.title as string,
      kind: "meeting" as const,
      href: `/meetings/${m.id}`,
    })),
    ...(eventsRes.data ?? []).map((e) => ({
      id: `event-${e.id}`,
      date: new Date(e.starts_at as string),
      label: e.name as string,
      kind: "event" as const,
      href: `/events/${e.id}`,
    })),
    ...(followUpsRes.data ?? []).map((f) => ({
      id: `follow-${f.id}`,
      date: parse(f.due_at as string, "yyyy-MM-dd", new Date()),
      label: f.title as string,
      kind: "follow_up" as const,
      href: `/crm/${f.crm_organization_id}`,
    })),
  ];

  const previousMonth = format(addMonths(current, -1), "yyyy-MM");
  const nextMonth = format(addMonths(current, 1), "yyyy-MM");

  return (
    <div>
      <PageHeader
        eyebrow="Schedule"
        title={format(current, "MMMM yyyy")}
        description="Tasks, milestones, meetings, events, and CRM follow-ups on one calendar."
        actions={
          <nav aria-label="Month navigation" className="flex items-center gap-1">
            <Link
              href={`/calendar?month=${previousMonth}`}
              className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
            >
              ← {format(addMonths(current, -1), "MMM")}
            </Link>
            <Link
              href="/calendar"
              className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
            >
              Today
            </Link>
            <Link
              href={`/calendar?month=${nextMonth}`}
              className="rounded-(--radius-sm) border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-soft"
            >
              {format(addMonths(current, 1), "MMM")} →
            </Link>
          </nav>
        }
      />

      {/* Legend — kinds are text-labeled, not color-alone */}
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
            {Array.from({ length: days.length / 7 }).map((_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => {
                  const dayItems = items.filter((item) =>
                    isSameDay(item.date, day),
                  );
                  return (
                    <td
                      key={day.toISOString()}
                      className={cn(
                        "h-28 border-b border-l border-line p-1.5 align-top first:border-l-0",
                        !isSameMonth(day, current) && "bg-surface-soft/40",
                      )}
                    >
                      <p
                        className={cn(
                          "mb-1 text-[12px]",
                          isToday(day)
                            ? "inline-flex size-5.5 items-center justify-center rounded-full bg-brand font-semibold text-white"
                            : isSameMonth(day, current)
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
    </div>
  );
}
