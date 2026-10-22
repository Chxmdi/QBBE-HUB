import type { Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { formattersWith } from "@/lib/i18n/format-core";

export { formatCurrency, formatNumber, type Formatters } from "@/lib/i18n/format-core";

/**
 * Every formatter, bound to one language, for server code. It loads both
 * catalogues; browser code gets its formatters from `useFormatters()`.
 */
export function formattersFor(locale: Locale) {
  return formattersWith(locale, createTranslator(locale));
}
