import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/** English and Quebec French for Google objects (V1-15); French is typed from English. */
const en: GoogleObjectsText = catalogues.en;
const frCA: GoogleObjectsText = catalogues["fr-CA"];

export type GoogleObjectsText = typeof englishText;

export function googleObjectsText(locale: Locale): GoogleObjectsText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
