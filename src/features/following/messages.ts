import type { Locale } from "@/lib/i18n/config";
import { catalogues } from "./catalogues";
import type { en as englishText } from "./messages.en";

/** English and Quebec French for following (V1-14); French is typed from English. */
const en: FollowingText = catalogues.en;
const frCA: FollowingText = catalogues["fr-CA"];

export type FollowingText = typeof englishText;

export function followingText(locale: Locale): FollowingText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
