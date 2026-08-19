/**
 * Just enough cron to answer "when does this run next?".
 *
 * Admin → Jobs shows a next-run time, and Postgres has no function that will
 * tell us one. This parses the five-field subset the registry actually uses —
 * numbers, wildcards, `a-b` ranges, `a,b` lists, and step values — and walks
 * forward minute by minute from a given instant.
 *
 * Everything is UTC, matching pg_cron. Anything it cannot parse returns null
 * rather than a wrong time; the panel then shows the raw expression, which is
 * honest, instead of a confident fiction.
 */

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, 0 = Sunday
];

function parseField(field: string, [min, max]: [number, number]): Set<number> | null {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-").map((n) => Number.parseInt(n, 10));
      if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
      start = from;
      end = to;
    } else {
      const only = Number.parseInt(rangePart, 10);
      if (!Number.isInteger(only)) return null;
      start = only;
      end = stepPart === undefined ? only : max;
    }

    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values.size > 0 ? values : null;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  restrictsDayOfMonth: boolean;
  restrictsDayOfWeek: boolean;
}

export function parseCron(expression: string): ParsedCron | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const parsed = fields.map((field, index) => parseField(field, FIELD_RANGES[index]));
  if (parsed.some((set) => set === null)) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parsed as Set<number>[];
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    restrictsDayOfMonth: fields[2] !== "*",
    restrictsDayOfWeek: fields[4] !== "*",
  };
}

/**
 * The next instant at or after `from` that matches. Cron's day fields are an
 * OR when both are restricted, which is the one genuinely surprising rule in
 * the format, so it is spelled out rather than assumed.
 */
export function nextRun(expression: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;

  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Two years of minutes is far past any schedule this registry can express.
  const limit = new Date(from.getTime() + 366 * 2 * 86_400_000);

  while (candidate <= limit) {
    const matchesMonth = cron.month.has(candidate.getUTCMonth() + 1);
    if (!matchesMonth) {
      candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    const dayOfMonthHit = cron.dayOfMonth.has(candidate.getUTCDate());
    const dayOfWeekHit = cron.dayOfWeek.has(candidate.getUTCDay());
    const matchesDay =
      cron.restrictsDayOfMonth && cron.restrictsDayOfWeek
        ? dayOfMonthHit || dayOfWeekHit
        : dayOfMonthHit && dayOfWeekHit;

    if (!matchesDay) {
      candidate.setUTCDate(candidate.getUTCDate() + 1);
      candidate.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (!cron.hour.has(candidate.getUTCHours())) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    if (!cron.minute.has(candidate.getUTCMinutes())) {
      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    return candidate;
  }

  return null;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A short plain-English gloss for the expressions the registry uses. */
export function describeSchedule(expression: string): string {
  const cron = parseCron(expression);
  if (!cron) return expression;

  const [minuteField, hourField, , , dayField] = expression.trim().split(/\s+/);

  if (minuteField === "*" && hourField === "*") return "Every minute";
  if (minuteField.startsWith("*/") && hourField === "*") {
    return `Every ${minuteField.slice(2)} minutes`;
  }
  if (hourField === "*") return "Hourly";

  const times = [...cron.hour]
    .sort((a, b) => a - b)
    .map((hour) => `${String(hour).padStart(2, "0")}:${String([...cron.minute][0] ?? 0).padStart(2, "0")}`)
    .join(", ");

  if (dayField === "*") return `Daily at ${times} UTC`;

  const days = [...cron.dayOfWeek].sort((a, b) => a - b).map((day) => DAY_NAMES[day]);
  const dayLabel =
    days.length === 5 && days[0] === "Monday" && days[4] === "Friday"
      ? "Weekdays"
      : days.join(", ");

  return `${dayLabel} at ${times} UTC`;
}
