import { interpolate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

/**
 * A module's own dictionary, kept beside the module instead of in the shared
 * catalogue (src/lib/i18n/messages), so parallel Workspace OS streams never
 * edit the same file. Integration folds it into the shared catalogue later.
 */
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type ModuleTranslate<M> = (key: Leaves<M>, vars?: Record<string, string | number>) => string;

function lookup(catalog: unknown, key: string): string | undefined {
  let node = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function createModuleTranslator<M>(catalogs: Record<Locale, M>) {
  return (locale: Locale): ModuleTranslate<M> =>
    (key, vars) =>
      interpolate(lookup(catalogs[locale], key) ?? lookup(catalogs.en, key) ?? key, vars);
}
