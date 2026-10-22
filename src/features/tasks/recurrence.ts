/** Recurrence helpers kept out of the server-action module so unit tests stay pure. */

/** Days in a month (month is 0-based), in UTC so no time zone can move it. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The date after `fromIso` for a weekly or monthly rule.
 *
 * A monthly repeat keeps the day of month of `anchorIso` (the date the chain
 * was set up on; `fromIso` when there is none), and lands on the last day of
 * a month too short for it: from 31 January, 28 February, then 31 March.
 * Adding a month to 31 January the plain way gives 3 March, which skipped
 * February and moved every later occurrence to the 3rd.
 */
export function nextOccurrence(rule: string, fromIso: string, anchorIso?: string | null): string {
  const [year, month, day] = fromIso.split("-").map(Number);
  if (rule === "weekly") {
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  }
  if (rule === "monthly") {
    const wanted = Number((anchorIso ?? fromIso).split("-")[2]);
    const target = new Date(Date.UTC(year, month, 1));
    const lastDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
    target.setUTCDate(Math.min(wanted, lastDay));
    return target.toISOString().slice(0, 10);
  }
  return fromIso;
}
