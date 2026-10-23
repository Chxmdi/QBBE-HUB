import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/**
 * English and Quebec French text for forms for any type (V1-6). Kept in the
 * module until integration mounts it in the shared catalogue; the French
 * object is typed from the English one, so a missing string is a type error.
 */
const en: FormsV2Text = catalogues.en;
const frCA: FormsV2Text = catalogues["fr-CA"];

export type FormsV2Text = typeof englishText;

export function formsV2Text(locale: Locale): FormsV2Text {
  return locale === "fr-CA" ? frCA : en;
}

/** Fills `{name}` placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
