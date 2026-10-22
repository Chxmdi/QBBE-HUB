import { intlLocale, type Locale } from "@/lib/i18n/config";

export const MONTHS_IN_YEAR = 12;

/**
 * An annual amount spread evenly over twelve months. Cents that do not divide
 * evenly go to the first months, one each, so the months always add up to
 * the annual amount exactly.
 */
export function evenSplit(annualCents: number): number[] {
  const base = Math.floor(annualCents / MONTHS_IN_YEAR);
  const remainder = annualCents - base * MONTHS_IN_YEAR;
  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** "2026-10-01" → ["2026-10", "2026-11", …, "2027-09"]. */
export function fiscalMonths(fiscalYearStart: string): string[] {
  const [year, month] = fiscalYearStart.split("-").map(Number);
  return Array.from({ length: MONTHS_IN_YEAR }, (_, i) => {
    const m = month - 1 + i;
    const y = year + Math.floor(m / 12);
    return `${y}-${String((m % 12) + 1).padStart(2, "0")}`;
  });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026" (French: "oct. 2026"). */
export function monthLabel(month: string, locale: Locale = "en"): string {
  const [y, m] = month.split("-").map(Number);
  if (locale === "en") return `${MONTH_NAMES[m - 1]} ${y}`;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, 1),
  );
}
