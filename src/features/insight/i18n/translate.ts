import { getLocale } from "@/lib/i18n/server";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import { insightEn, type InsightMessages } from "./en";
import { insightFr } from "./fr-CA";

/**
 * Translations for the Insight stream (graph and map lenses, dashboards and
 * analytics), kept in this module until integration folds them into the
 * shared catalogue. Same lookup and `{name}` placeholders as `@/lib/i18n`.
 */

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type InsightKey = Leaves<InsightMessages>;
export type InsightT = (key: InsightKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, InsightMessages> = { en: insightEn, "fr-CA": insightFr };

function lookup(catalog: InsightMessages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function createInsightTranslator(locale: Locale): InsightT {
  const catalog = CATALOGS[locale] ?? insightEn;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(insightEn, key) ?? key, vars);
}

/** `t()` for this module's server components, in the request's language. */
export async function getInsightT(): Promise<InsightT> {
  return createInsightTranslator(await getLocale());
}
