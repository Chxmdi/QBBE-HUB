import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

/**
 * A translator over one Workspace OS module's own catalogue.
 *
 * Streams keep their strings out of the shared catalogue until integration
 * mounts them (workspace-os-execution.md section 2), so each module ships an
 * English source and a Quebec French copy typed against it. The French type
 * makes a missing key a compile error, as it is in the shared catalogue.
 */
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** The same shape with every string widened, for the French copy's type. */
export type Translation<T> = { [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

export type ModuleTranslateFn<T> = (key: Leaves<T>, vars?: MessageVars) => string;

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function moduleTranslator<T>(
  catalogs: { en: T; "fr-CA": Translation<T> },
  locale: Locale,
): ModuleTranslateFn<T> {
  const catalog = catalogs[locale] ?? catalogs.en;
  return (key, vars) => interpolate(lookup(catalog, key) ?? lookup(catalogs.en, key) ?? key, vars);
}

/** Every key path in a catalogue, for the parity test. */
export function catalogKeys(catalog: unknown, prefix = ""): string[] {
  if (catalog === null || typeof catalog !== "object") return [prefix];
  return Object.entries(catalog as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : catalogKeys(value, `${prefix}${key}.`),
  );
}
