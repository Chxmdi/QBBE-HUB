import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/** English and Quebec French for workspace upkeep (V3-2); French is typed from English. */
const en: UpkeepText = catalogues.en;
const frCA: UpkeepText = catalogues["fr-CA"];

export type UpkeepText = typeof englishText;

export function upkeepText(locale: Locale): UpkeepText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
