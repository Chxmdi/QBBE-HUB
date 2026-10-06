import Link from "next/link";
import { format } from "date-fns";
import { KIND_STYLES } from "@/features/calendar/components/week-view";
import { RescheduleControl } from "@/features/calendar/components/reschedule-control";
import { calendarDateFormats } from "@/features/calendar/components/week-view";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { LensT } from "@/features/lenses/i18n";
import type { LensCalendarItem } from "./model";

const CHIPS_PER_DAY = 4;

/**
 * A month of a lens as a table: one row per week, one cell per day, the
 * day's records as links (and a date field to move a task, where allowed).
 * The same look as /calendar's month view.
 */
export function MonthGrid({
  days,
  month,
  items,
  locale,
  today,
  t,
}: {
  days: string[];
  month: string;
  items: LensCalendarItem[];
  locale: Locale;
  today: string;
  t: LensT;
}) {
  const formats = calendarDateFormats(locale);
  const byDay = new Map<string, LensCalendarItem[]>();
  for (const item of items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const label = format(new Date(`${month}-15T12:00:00Z`), formats.monthYear, formats.options);
  return (
    <div className="card relative overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[720px] table-fixed border-collapse">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {days.slice(0, 7).map((day) => (
              <th key={day} scope="col" className="border-b border-line bg-surface-soft/60 px-2 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {format(new Date(`${day}T12:00:00Z`), "EEE", formats.options)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: days.length / 7 }).map((_, week) => (
            <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map((day) => {
                const dayItems = byDay.get(day) ?? [];
                const shown = dayItems.slice(0, CHIPS_PER_DAY);
                return (
                  <td
                    key={day}
                    data-day={day}
                    className={cn("h-28 border-b border-l border-line p-1.5 align-top first:border-l-0", !day.startsWith(month) && "bg-surface-soft/40")}
                  >
                    <p className={cn("mb-1 text-[12px] font-medium", day === today ? "text-brand-fg" : "text-muted")}>
                      <time dateTime={day}>{format(new Date(`${day}T12:00:00Z`), formats.shortDay, formats.options)}</time>
                    </p>
                    <ul className="space-y-1">
                      {shown.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={item.href}
                            title={item.owner ? `${item.label} · ${item.owner}` : item.label}
                            className={cn("block truncate rounded px-1.5 py-0.5 text-[11.5px] font-medium", KIND_STYLES[item.kind], item.done && "line-through")}
                          >
                            {item.label}
                          </Link>
                          {item.reschedulableDate ? (
                            <RescheduleControl kind="task" id={item.recordId} label={item.label} date={item.reschedulableDate} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {dayItems.length > shown.length ? (
                      <p className="mt-1 text-[11px] text-muted">{t("calendar.more", { count: dayItems.length - shown.length })}</p>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
