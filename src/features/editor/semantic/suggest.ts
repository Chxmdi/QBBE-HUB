import { addCalendarDays } from "@/lib/time";

/**
 * The "Make a task" suggestion (M6): a line that names a person and a date,
 * in English or French, looks like a task. Rules only, no AI: a person is a
 * member's full name, first name or @first-name as a whole word; a date is
 * one of the phrases below, resolved against today's date in the
 * organization's zone. The editor shows a quiet margin icon for a match and
 * never interrupts.
 */

export interface SuggestPerson {
  id: string;
  name: string;
}

export interface TaskSuggestion {
  personId: string;
  personName: string;
  /** Calendar date, YYYY-MM-DD. */
  due: string;
  /** The line itself, trimmed, as the task title. */
  title: string;
}

/** Lower case, accents removed, apostrophes unified: "D’ici Mercredi" is "d'ici mercredi". */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** The next given weekday after today (a weekday named today means next week's). */
function nextWeekday(today: string, target: number): string {
  const diff = (target - weekday(today) + 7) % 7 || 7;
  return addCalendarDays(today, diff)!;
}

/** A day and month, this year, or next year if it has already passed. */
function dayMonth(today: string, day: number, month: number): string | null {
  if (day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const candidate = `${y}-${pad(month)}-${pad(day)}`;
    const check = new Date(`${candidate}T12:00:00Z`);
    if (check.getUTCMonth() + 1 !== month) return null;
    if (candidate >= today) return candidate;
  }
  return null;
}

/** The first date phrase in the text, as a calendar date; null if there is none. */
export function findDate(text: string, today: string): string | null {
  const t = ` ${fold(text)} `;
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (!Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) return date;
  }
  if (/\b(today|aujourd'hui|ce soir|tonight)\b/.test(t)) return today;
  if (/\b(tomorrow|demain)\b/.test(t)) return addCalendarDays(today, 1);
  if (/\b(next week|la semaine prochaine|semaine prochaine)\b/.test(t)) {
    return nextWeekday(today, 1);
  }
  if (/\b(end of (the )?week|fin de (la )?semaine)\b/.test(t)) return nextWeekday(addCalendarDays(today, -1)!, 5);
  const inDays = t.match(/\b(?:in|dans) (\d{1,2}) (?:days?|jours?)\b/);
  if (inDays) return addCalendarDays(today, Number(inDays[1]));
  const inWeeks = t.match(/\b(?:in|dans) (\d{1,2}) (?:weeks?|semaines?)\b/);
  if (inWeeks) return addCalendarDays(today, Number(inWeeks[1]) * 7);

  const monthNames = Object.keys(MONTHS).join("|");
  // "12 March", "le 12 mars", "1er mai"
  const dm = t.match(new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)? (${monthNames})\\b`));
  if (dm) return dayMonth(today, Number(dm[1]), MONTHS[dm[2]]);
  // "March 12", "March 12th"
  const md = t.match(new RegExp(`\\b(${monthNames}) (\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (md) return dayMonth(today, Number(md[2]), MONTHS[md[1]]);

  const day = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/);
  if (day) return nextWeekday(today, WEEKDAYS[day[1]]);
  return null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first member the text names (full name first, then first name or @first-name). */
export function findPerson(text: string, people: SuggestPerson[]): SuggestPerson | null {
  const t = ` ${fold(text)} `;
  const named = people.filter((person) => person.name.trim().length > 1);
  for (const person of named) {
    if (new RegExp(`[\\s@(]${escape(fold(person.name.trim()))}(?=[\\s.,;:!?)'])`).test(t)) return person;
  }
  for (const person of named) {
    const first = fold(person.name.trim().split(/\s+/)[0]);
    if (first.length < 2) continue;
    if (new RegExp(`(^|[\\s(])@?${escape(first)}(?=[\\s.,;:!?)'])`).test(t)) return person;
  }
  return null;
}

/** A suggestion for one line of text, or null. */
export function suggestTask(text: string, people: SuggestPerson[], today: string): TaskSuggestion | null {
  const title = text.replace(/\s+/g, " ").trim();
  if (title.length < 4 || title.length > 300) return null;
  const person = findPerson(title, people);
  if (!person) return null;
  const due = findDate(title, today);
  if (!due) return null;
  return { personId: person.id, personName: person.name, due, title };
}
