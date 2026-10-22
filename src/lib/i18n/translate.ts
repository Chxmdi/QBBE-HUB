import { en } from "@/lib/i18n/messages/en";
import { frCA } from "@/lib/i18n/messages/fr-CA";
import type { Locale } from "@/lib/i18n/config";
import { translatorFor, type Messages, type TranslateFn } from "@/lib/i18n/translator";

/**
 * Both catalogues, for server code: pages, actions, jobs and email, which
 * write to people in either language. Browser code must not import this
 * module (it would ship both languages to every page); it gets `t` from
 * `useT()` instead. src/lib/i18n/client-catalogues.test.ts checks that.
 */

export {
  interpolate,
  type MessageKey,
  type MessageVars,
  type Messages,
  type TranslateFn,
} from "@/lib/i18n/translator";

const CATALOGS: Record<Locale, Messages> = { en, "fr-CA": frCA };

export function catalogFor(locale: Locale): Messages {
  return CATALOGS[locale] ?? en;
}

/**
 * Builds `t()` for one language. Falling back to English beats showing a raw
 * key to someone, and the key itself is the last resort.
 */
export function createTranslator(locale: Locale): TranslateFn {
  return translatorFor(catalogFor(locale), en);
}
