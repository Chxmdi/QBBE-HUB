import type { FilingFrequency } from "@/features/sales-tax/return-lines";

/** Books are kept in the app from this date; the first tax period starts here by default. */
export const FIRST_PERIOD_START = "2026-10-01";

const MONTHS: Record<FilingFrequency, number> = { monthly: 1, quarterly: 3, annual: 12 };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last day of the period of `frequency` that starts on `start`. */
export function periodEnd(start: string, frequency: FilingFrequency): string {
  const d = new Date(`${start}T00:00:00Z`);
  // Day 0 of the month after the last month is its last day.
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + MONTHS[frequency], d.getUTCDate() - 1));
  return end.toISOString().slice(0, 10);
}

/** The period that follows the latest one, or the first one when there is none. */
export function suggestNextPeriod(
  latestEnd: string | null,
  frequency: FilingFrequency,
): { startsOn: string; endsOn: string } {
  const startsOn = latestEnd ? addDays(latestEnd, 1) : FIRST_PERIOD_START;
  return { startsOn, endsOn: periodEnd(startsOn, frequency) };
}
