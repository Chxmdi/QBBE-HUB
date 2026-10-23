import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/** English and Quebec French for templates (V1-13); French is typed from English. */
const en: TemplatesV2Text = catalogues.en;
const frCA: TemplatesV2Text = catalogues["fr-CA"];

export type TemplatesV2Text = typeof englishText;

export function templatesV2Text(locale: Locale): TemplatesV2Text {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
