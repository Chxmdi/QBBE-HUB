import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { dueLabelWith } from "@/lib/utils";

/**
 * The due-date label in a given language, for server code (email, jobs).
 * Client components use `useFormatters().due`, which carries the page's own
 * translator and so does not load both catalogues.
 */
export function dueLabel(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
  locale: Locale = DEFAULT_LOCALE,
) {
  return dueLabelWith(createTranslator(locale), iso, timeZone, locale);
}
