import { getLocale } from "@/lib/i18n/server";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { objectsEn, type ObjectsMessages } from "./en";
import { objectsFr } from "./fr-CA";

/**
 * Translations for the object layer, kept in this module until integration
 * folds them into the shared catalogue. Same lookup and `{name}` placeholders
 * as `@/lib/i18n`.
 */

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type ObjectsKey = Leaves<ObjectsMessages>;
export type ObjectsT = (key: ObjectsKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, ObjectsMessages> = { en: objectsEn, "fr-CA": objectsFr };

function lookup(catalog: ObjectsMessages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function createObjectsTranslator(locale: Locale): ObjectsT {
  const catalog = CATALOGS[locale] ?? objectsEn;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(objectsEn, key) ?? key, vars);
}

/** `t()` for this module's server components, in the request's language. */
export async function getObjectsT(): Promise<{ t: ObjectsT; locale: Locale }> {
  const locale = await getLocale();
  return { t: createObjectsTranslator(locale), locale };
}
