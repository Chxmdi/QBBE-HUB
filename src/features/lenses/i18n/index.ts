import type { Locale } from "@/lib/i18n/config";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import { lensesEn, type LensMessages } from "./en";
import { lensesFrCA } from "./fr-CA";

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type LensMessageKey = Leaves<LensMessages>;
export type LensT = (key: LensMessageKey, vars?: MessageVars) => string;

const CATALOGS: Record<Locale, LensMessages> = { en: lensesEn, "fr-CA": lensesFrCA };

function lookup(catalog: LensMessages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `t()` for the lens screens in one language. Same rules as the shared translator. */
export function createLensT(locale: Locale): LensT {
  const catalog = CATALOGS[locale] ?? lensesEn;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(lensesEn, key) ?? key, vars);
}

export { lensesEn, lensesFrCA };
