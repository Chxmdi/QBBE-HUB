import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/** English and Quebec French for offline mode (V3-1); French is typed from English. */
const en: OfflineText = catalogues.en;
const frCA: OfflineText = catalogues["fr-CA"];

export type OfflineText = typeof englishText;

export function offlineText(locale: Locale): OfflineText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
