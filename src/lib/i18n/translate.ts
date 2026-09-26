import { en, type Messages } from "@/lib/i18n/messages/en";
import { frCA } from "@/lib/i18n/messages/fr-CA";
import type { Locale } from "@/lib/i18n/config";

export type { Messages };

/** Every dotted path to a string in the catalogue, e.g. "nav.home". */
export type MessageKey = Leaves<Messages>;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageVars = Record<string, string | number>;
export type TranslateFn = (key: MessageKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, Messages> = { en, "fr-CA": frCA };

export function catalogFor(locale: Locale): Messages {
  return CATALOGS[locale] ?? en;
}

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Replaces `{name}` placeholders. Unknown placeholders are left visible. */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Builds `t()` for one language.
 *
 * The types make a missing key a compile error, so the English fallback only
 * matters for a key typed as a plain string at runtime. Falling back to English
 * beats showing a raw key to someone, and the key itself is the last resort.
 */
export function createTranslator(locale: Locale): TranslateFn {
  const catalog = catalogFor(locale);
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(en, key) ?? key, vars);
}
