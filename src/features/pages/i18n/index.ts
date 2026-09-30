import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { pagesEn, type PagesMessages } from "./en";
import { pagesFrCA } from "./fr-CA";

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type PagesKey = Leaves<PagesMessages>;
export type PagesT = (key: PagesKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, PagesMessages> = { en: pagesEn, "fr-CA": pagesFrCA };

function lookup(catalog: PagesMessages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `t()` for the pages module in one language, falling back to English. */
export function createPagesT(locale: Locale): PagesT {
  const catalog = CATALOGS[locale] ?? pagesEn;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(pagesEn, key) ?? key, vars);
}

export { pagesEn, pagesFrCA };
