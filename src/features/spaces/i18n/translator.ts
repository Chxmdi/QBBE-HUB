import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";

/**
 * A module's own catalogue, kept beside the module instead of in the shared
 * dictionaries (Workspace OS streams work in parallel; integration may fold
 * these into src/lib/i18n/messages later). Shared by the spaces, sharing and
 * public-pages modules.
 */

/** The same shape as the English catalogue, every leaf a string. */
export type Catalogue<T> = { [K in keyof T]: T[K] extends string ? string : Catalogue<T[K]> };

/** Every dotted path to a string, e.g. "list.title". */
export type CatalogueKey<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : CatalogueKey<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type ModuleTranslate<T> = (key: CatalogueKey<T>, vars?: MessageVars) => string;

function lookup(catalogue: unknown, key: string): string | undefined {
  let node: unknown = catalogue;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** `t()` for one language; a missing French string falls back to English, then the key. */
export function moduleTranslator<T>(
  catalogues: Record<Locale, Catalogue<T>>,
  locale: Locale,
): ModuleTranslate<T> {
  const catalogue = catalogues[locale] ?? catalogues[DEFAULT_LOCALE];
  return (key, vars) =>
    interpolate(lookup(catalogue, key) ?? lookup(catalogues[DEFAULT_LOCALE], key) ?? key, vars);
}

/** Every leaf path of a catalogue, for tests. */
export function catalogueLeaves(catalogue: unknown, prefix = ""): [string, string][] {
  if (typeof catalogue === "string") return [[prefix, catalogue]];
  return Object.entries(catalogue as Record<string, unknown>).flatMap(([key, value]) =>
    catalogueLeaves(value, prefix ? `${prefix}.${key}` : key),
  );
}
