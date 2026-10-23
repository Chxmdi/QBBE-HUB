import type { Locale } from "@/lib/i18n/config";
import type { LocalizedText } from "@/lib/objects/contracts";
import { interpolate, type MessageVars } from "@/lib/i18n/translator";
import { catalogues } from "./catalogues";
import type { AppsMessages } from "./en";

const appsEn = catalogues.en;
const appsFrCA = catalogues["fr-CA"];

export type { AppsMessages };

export function appsMessages(locale: Locale): AppsMessages {
  return locale === "fr-CA" ? appsFrCA : appsEn;
}

export function fill(template: string, vars?: MessageVars): string {
  return interpolate(template, vars);
}

export function pick(text: LocalizedText, locale: Locale): string {
  return locale === "fr-CA" ? text.fr : text.en;
}

export function appErrorText(messages: AppsMessages, code: string): string {
  const value = (messages.errors as Record<string, unknown>)[code];
  return typeof value === "string" ? value : messages.errors.invalid;
}
