import Link from "next/link";
import { format } from "date-fns";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";
import {
  calendarDateFormats,
  KIND_STYLES,
  type CalendarItem,
} from "@/features/calendar/calendar-items";

// Kept here too for the pages that import them from this file.
export { calendarDateFormats, KIND_STYLES, type CalendarItem };
import { RescheduleControl } from "@/features/calendar/components/reschedule-control";
import { dayAsLocalDate } from "@/features/calendar/calendar-model";

/** Short type prefix so kind never rests on color alone (§10.9). */
function kindPrefix(kind: CalendarItem["kind"], t: TranslateFn): string {
  return t(`calendar.kinds.${kind}`);
}

function rescheduleControl(item: CalendarItem) {
  if (!item.reschedulableDate) return null;
  if (item.kind !== "task" && item.kind !== "milestone") return null;
  return (
    <RescheduleControl
      kind={item.kind}
      id={item.recordId ?? item.id}
      label={item.label}
      date={item.reschedulableDate}
    />
  );
}

function calendarItemTitle(item: CalendarItem, t: TranslateFn): string {
  const parts = [t("calendar.itemTitle", { kind: kindPrefix(item.kind, t), label: item.label })];
  if (item.owner) parts.push(t("calendar.itemOwner", { name: item.owner }));
  if (item.done) parts.push(t("calendar.itemCompleted"));
  return parts.join(" · ");
}

/**
 * Week view — the primary operational calendar view (§10.9). Timed items
 * show their time; deadlines and milestones render as all-day chips so the
 * two are distinguishable without relying on color.
 */
export function WeekView({
  days,
  today,
  items,
  locale,
}: {
  /** The week's days, YYYY-MM-DD, Sunday first. */
  days: string[];
  /** Today in the workspace zone. */
  today: string;
  items: CalendarItem[];
  locale: Locale;
}) {
  const t = createTranslator(locale);
  const formats = calendarDateFormats(locale);

  return (
    <div className="card relative overflow-x-auto">
      <div className="grid min-w-[860px] grid-cols-7">
        {days.map((day) => {
          const dayItems = items
            .filter((item) => item.day === day)
            .sort((a, b) => a.date.getTime() - b.date.getTime());
          const allDay = dayItems.filter((i) => !i.timed);
          const timed = dayItems.filter((i) => i.timed);
          const isToday = day === today;
          const label = dayAsLocalDate(day);
          return (
            <div
              key={day}
              data-day={day}
              className="min-h-[26rem] border-r border-line last:border-r-0"
            >
              <div
                className={cn(
                  "sticky top-0 border-b border-line px-2.5 py-2",
                  isToday ? "bg-brand-soft" : "bg-surface-soft/60",
                )}
              >
                <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {format(label, "EEE", formats.options)}
                </p>
                <p
                  className={cn(
                    "text-[17px] font-semibold",
                    isToday && "text-brand-fg",
                  )}
                >
                  {format(label, "d")}
                  {isToday ? (
                    <span className="ml-1.5 text-[10.5px] font-medium">{t("calendar.today")}</span>
                  ) : null}
                </p>
              </div>

              <div className="space-y-1 p-1.5">
                {allDay.length > 0 ? (
                  <div className="space-y-1 border-b border-line pb-1.5">
                    {allDay.map((item) => (
                      <div key={item.id}>
                      <Link
                        href={item.href}
                        title={calendarItemTitle(item, t)}
                        className={cn(
                          "block rounded px-1.5 py-1 text-[11px] font-medium hover:opacity-80",
                          KIND_STYLES[item.kind],
                        )}
                      >
                        <span className="block text-[9.5px] tracking-wide uppercase">
                          {kindPrefix(item.kind, t)}
                        </span>
                        <span className={cn("line-clamp-2", item.done && "line-through opacity-70")}>
                          <span className={cn(item.done && "line-through opacity-70")}>
                        {item.label}
                      </span>
                        </span>
                      </Link>
                      {rescheduleControl(item)}
                      </div>
                    ))}
                  </div>
                ) : null}

                {timed.map((item) => (
                  <div key={item.id}>
                  <Link
                    href={item.href}
                    title={calendarItemTitle(item, t)}
                    className={cn(
                      "block rounded px-1.5 py-1 text-[11px] font-medium hover:opacity-80",
                      KIND_STYLES[item.kind],
                    )}
                  >
                    <span className="block text-[9.5px]">
                      {item.timeLabel ?? format(item.date, formats.time, formats.options)} · {kindPrefix(item.kind, t)}
                    </span>
                    <span className={cn("line-clamp-2", item.done && "line-through opacity-70")}>
                      <span className={cn(item.done && "line-through opacity-70")}>
                        {item.label}
                      </span>
                    </span>
                  </Link>
                  {rescheduleControl(item)}
                  </div>
                ))}

                {dayItems.length === 0 ? (
                  <p className="px-1.5 py-3 text-center text-[11px] text-muted">
                    {t("calendar.nothingScheduled")}
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
export function AgendaView({
  items,
  today,
  locale,
}: {
  items: CalendarItem[];
  /** Today in the workspace zone. */
  today: string;
  locale: Locale;
}) {
  const t = createTranslator(locale);
  const formats = calendarDateFormats(locale);
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of sorted) {
    const key = item.day;
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  }

  if (sorted.length === 0) {
    return (
      <p className="card px-4 py-8 text-center text-[13px] text-muted">
        {t("calendar.nothingInRange")}
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {Array.from(byDay.entries()).map(([key, dayItems]) => {
        const date = dayAsLocalDate(key);
        const isToday = key === today;
        return (
          <li key={key}>
            <p
              className={cn(
                "mb-1.5 text-[12.5px] font-semibold",
                isToday && "text-brand-fg",
              )}
            >
              {format(date, formats.agendaDay, formats.options)}
              {isToday ? t("calendar.todaySuffix") : ""}
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
                      {kindPrefix(item.kind, t)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      <span className={cn(item.done && "line-through opacity-70")}>
                        {item.label}
                      </span>
                    </span>
                    {item.timed ? (
                      <span className="meta whitespace-nowrap">
                        {item.timeLabel ?? format(item.date, formats.time, formats.options)}
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
