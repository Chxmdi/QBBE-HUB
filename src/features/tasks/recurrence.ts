/** Recurrence helpers kept out of the server-action module so unit tests stay pure. */
export function nextOccurrence(rule: string, fromIso: string): string {
  const [year, month, day] = fromIso.split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1, day));
  if (rule === "weekly") {
    from.setUTCDate(from.getUTCDate() + 7);
  } else if (rule === "monthly") {
    from.setUTCMonth(from.getUTCMonth() + 1);
  }
  return from.toISOString().slice(0, 10);
}
