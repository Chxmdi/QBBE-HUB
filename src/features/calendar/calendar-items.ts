import { frCA } from "date-fns/locale";
import type { Locale } from "@/lib/i18n/config";

// The calendar's item shape, chip colours and date patterns, apart from the
// week and agenda views. The month grid uses them in the browser, and the
// views build a translator with both languages, which the browser must not
// load. They are re-exported from week-view.tsx.

export interface CalendarItem {
  id: string;
  date: Date;
  label: string;
  kind: "task" | "milestone" | "meeting" | "event" | "follow_up" | "google";
  href: string;
  timed: boolean;
  /**
   * Who is accountable, where the record names somebody. Shown in the tooltip
   * rather than the chip: the chip has room for one line and the name is not
   * the thing somebody scans a calendar for.
   */
  owner?: string | null;
  /** Already met. Rendered struck through, not hidden — it still happened. */
  done?: boolean;
  /**
   * The record's own date as `yyyy-MM-dd` in the workspace zone, present only
   * on records this viewer may move. Absence is what hides the control: the
   * caller decides who may reschedule, so the chip never has to guess, and a
   * viewer who cannot move a record is not shown a field that would fail.
   */
  reschedulableDate?: string | null;
  /**
   * The record's own id. `id` above is prefixed to keep chips unique across
   * six record types in one list, so it is not the value any command wants.
   */
  recordId?: string;
}

export const KIND_STYLES: Record<CalendarItem["kind"], string> = {
  // Both used to pin a hex literal for one theme; the -fg tokens already
  // carry a designed dark value. The milestone chip failed dark-mode
  // contrast (axe, qa-matrix, #101).
  task: "bg-brand-soft text-brand-fg",
  milestone: "bg-accent/20 text-accent-fg",
  meeting: "bg-info/12 text-info-fg",
  event: "bg-success/12 text-success-fg",
  follow_up: "bg-warning/12 text-warning-fg",
  google: "bg-surface-soft text-muted",
};

/**
 * date-fns patterns and options for visible text in one language. French
 * reads the clock on 24 hours ("14 h 30") and puts the day before the month.
 */
export function calendarDateFormats(locale: Locale) {
  const french = locale === "fr-CA";
  return {
    options: french ? { locale: frCA } : {},
    time: french ? "H 'h' mm" : "h:mm a",
    agendaDay: french ? "EEEE d MMM" : "EEEE, MMM d",
    rangeStart: french ? "d MMM" : "MMM d",
    rangeEnd: french ? "d MMM yyyy" : "MMM d, yyyy",
    monthYear: "MMMM yyyy",
    shortMonthYear: "MMM yyyy",
    shortDay: french ? "d MMM" : "MMM d",
  };
}

