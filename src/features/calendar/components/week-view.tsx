import Link from "next/link";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  isToday,
  startOfWeek,
} from "date-fns";
import { cn } from "@/lib/utils";

export interface CalendarItem {
  id: string;
  date: Date;
  label: string;
  kind: "task" | "milestone" | "meeting" | "event" | "follow_up";
  href: string;
  timed: boolean;
}

export const KIND_STYLES: Record<CalendarItem["kind"], string> = {
  task: "bg-brand-soft text-brand dark:text-[#f2b8c8]",
  milestone: "bg-accent/20 text-[#7a5f1a] dark:text-accent",
  meeting: "bg-info/12 text-info",
  event: "bg-success/12 text-success",
  follow_up: "bg-warning/12 text-warning",
};

/** Short type prefix so kind never rests on color alone (§10.9). */
const KIND_PREFIX: Record<CalendarItem["kind"], string> = {
  task: "Task",
  milestone: "Milestone",
  meeting: "Meeting",
  event: "Event",
  follow_up: "Follow-up",
};

/**
 * Week view — the primary operational calendar view (§10.9). Timed items
 * show their time; deadlines and milestones render as all-day chips so the
 * two are distinguishable without relying on color.
 */
export function WeekView({
  anchor,
  items,
}: {
  anchor: Date;
  items: CalendarItem[];
}) {
  const start = startOfWeek(anchor, { weekStartsOn: 0 });
  const days = eachDayOfInterval({
    start,
    end: endOfWeek(anchor, { weekStartsOn: 0 }),
  });

  return (
    <div className="card overflow-x-auto">
      <div className="grid min-w-[860px] grid-cols-7">
        {days.map((day) => {
          const dayItems = items
            .filter((item) => isSameDay(item.date, day))
            .sort((a, b) => a.date.getTime() - b.date.getTime());
          const allDay = dayItems.filter((i) => !i.timed);
          const timed = dayItems.filter((i) => i.timed);
          return (
            <div
              key={day.toISOString()}
              className="min-h-[26rem] border-r border-line last:border-r-0"
            >
              <div
                className={cn(
                  "sticky top-0 border-b border-line px-2.5 py-2",
                  isToday(day) ? "bg-brand-soft" : "bg-surface-soft/60",
                )}
              >
                <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {format(day, "EEE")}
                </p>
                <p
                  className={cn(
                    "text-[17px] font-semibold",
                    isToday(day) && "text-brand",
                  )}
                >
                  {format(day, "d")}
                  {isToday(day) ? (
                    <span className="ml-1.5 text-[10.5px] font-medium">Today</span>
                  ) : null}
                </p>
              </div>

              <div className="space-y-1 p-1.5">
                {allDay.length > 0 ? (
                  <div className="space-y-1 border-b border-line pb-1.5">
                    {allDay.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        title={`${KIND_PREFIX[item.kind]}: ${item.label}`}
                        className={cn(
                          "block rounded px-1.5 py-1 text-[11px] font-medium hover:opacity-80",
                          KIND_STYLES[item.kind],
                        )}
                      >
                        <span className="block text-[9.5px] tracking-wide uppercase opacity-80">
                          {KIND_PREFIX[item.kind]}
                        </span>
                        <span className="line-clamp-2">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}

                {timed.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    title={`${KIND_PREFIX[item.kind]}: ${item.label}`}
                    className={cn(
                      "block rounded px-1.5 py-1 text-[11px] font-medium hover:opacity-80",
                      KIND_STYLES[item.kind],
                    )}
                  >
                    <span className="block text-[9.5px] opacity-80">
                      {format(item.date, "h:mm a")} · {KIND_PREFIX[item.kind]}
                    </span>
                    <span className="line-clamp-2">{item.label}</span>
                  </Link>
                ))}

                {dayItems.length === 0 ? (
                  <p className="px-1.5 py-3 text-center text-[11px] text-muted/60">
                    Nothing scheduled
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Mobile agenda view (§11.2): a linear list rather than a compressed grid.
 */
export function AgendaView({ items }: { items: CalendarItem[] }) {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of sorted) {
    const key = format(item.date, "yyyy-MM-dd");
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  if (sorted.length === 0) {
    return (
      <p className="card px-4 py-8 text-center text-[13px] text-muted">
        Nothing scheduled in this range.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {Array.from(byDay.entries()).map(([key, dayItems]) => {
        const date = dayItems[0].date;
        return (
          <li key={key}>
            <p
              className={cn(
                "mb-1.5 text-[12.5px] font-semibold",
                isToday(date) && "text-brand",
              )}
            >
              {format(date, "EEEE, MMM d")}
              {isToday(date) ? " · Today" : ""}
            </p>
            <ul className="card divide-y divide-line">
              {dayItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="interactive-row flex items-center gap-3 px-4 py-2.5"
                  >
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                        KIND_STYLES[item.kind],
                      )}
                    >
                      {KIND_PREFIX[item.kind]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {item.label}
                    </span>
                    {item.timed ? (
                      <span className="meta whitespace-nowrap">
                        {format(item.date, "h:mm a")}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
