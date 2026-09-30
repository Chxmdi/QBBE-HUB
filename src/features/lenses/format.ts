import { intlLocale, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/utils";
import type { CatalogProperty } from "@/lib/query/catalog";
import type { LensValue } from "@/lib/query/run";
import { rawText } from "./table/model";

/**
 * The text a lens shows for one value, in the viewer's language: calendar
 * dates as dates (never shifted by a time zone), timestamps in the viewer's
 * zone, numbers with local separators, options and references by label.
 */
export function formatLensValue(
  property: CatalogProperty,
  value: LensValue,
  locale: Locale,
  timeZone: string,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (property.kind === "date" && typeof value === "string") {
    if (property.timestamp) return formatDate(value, timeZone, locale);
    return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${value.slice(0, 10)}T00:00:00Z`),
    );
  }
  if (property.kind === "number" && (typeof value === "number" || typeof value === "string")) {
    return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(Number(value));
  }
  return rawText(property, value, locale) ?? "";
}
