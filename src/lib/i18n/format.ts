import { DEFAULT_TIME_ZONE, formatInZone } from "@/lib/time";
import {
  dueLabel,
  formatDate,
  formatDateTime,
  formatTime,
  relativeTime,
} from "@/lib/utils";
import { intlLocale, type Locale } from "@/lib/i18n/config";

/** `1 234,56` in French, `1,234.56` in English. */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/**
 * Money in Canadian dollars by default: `1 234,56 $` in French,
 * `$1,234.56` in English.
 */
export function formatCurrency(
  amount: number,
  locale: Locale,
  currency: string = "CAD",
): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
    // Canadian dollars written in Canada need no "CA" prefix.
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

/** Every formatter, bound to one language, for components to pull from. */
export function formattersFor(locale: Locale) {
  return {
    date: (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) =>
      formatDate(iso, timeZone, locale),
    dateTime: (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) =>
      formatDateTime(iso, timeZone, locale),
    time: (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) =>
      formatTime(iso, timeZone, locale),
    inZone: (
      iso: string | null | undefined,
      timeZone: string = DEFAULT_TIME_ZONE,
      options: Intl.DateTimeFormatOptions = {},
    ) => formatInZone(iso, timeZone, options, locale),
    relative: (iso: string) => relativeTime(iso, locale),
    due: (iso: string | null | undefined, timeZone: string = DEFAULT_TIME_ZONE) =>
      dueLabel(iso, timeZone, locale),
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    currency: (amount: number, currency?: string) => formatCurrency(amount, locale, currency),
  };
}

export type Formatters = ReturnType<typeof formattersFor>;
