import type { Locale } from "@/lib/i18n/config";
import type { LocalizedText } from "@/lib/objects/contracts";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import { blueprintsEn, type BlueprintsMessages } from "./en";
import { blueprintsFrCA } from "./fr-CA";

export type { BlueprintsMessages };

export function blueprintsMessages(locale: Locale): BlueprintsMessages {
  return locale === "fr-CA" ? blueprintsFrCA : blueprintsEn;
}

/** Fills `{name}` placeholders, as the shared translator does. */
export function fill(template: string, vars?: MessageVars): string {
  return interpolate(template, vars);
}

/** The side of a bilingual value that matches the interface language. */
export function pick(text: LocalizedText, locale: Locale): string {
  return locale === "fr-CA" ? text.fr : text.en;
}

/** An `errors.*` message for a validation code, falling back to "invalid". */
export function errorText(messages: BlueprintsMessages, code: string): string {
  const value = (messages.errors as Record<string, unknown>)[code];
  return typeof value === "string" ? value : messages.errors.invalid;
}
