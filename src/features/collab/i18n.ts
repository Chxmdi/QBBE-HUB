import type { Locale } from "@/lib/i18n/config";

/**
 * Module-local catalogues for the collaboration stream (S3b, epic #199).
 *
 * Each module (object comments, versions, layouts, co-editing) keeps its own
 * English and Quebec French files, typed so a French key that is missing is a
 * compile error. They are not mounted in the shared catalogue yet: integration
 * moves them under the shared `t()` when the menus are wired, and until then
 * nothing outside these modules reads them.
 */

/** A catalogue shaped like the English one, with every leaf a string. */
export type Catalogue<T> = {
  [K in keyof T]: T[K] extends string ? string : Catalogue<T[K]>;
};

export function pickCatalogue<T extends Catalogue<T>>(
  catalogues: { en: T; "fr-CA": Catalogue<T> },
  locale: Locale,
): Catalogue<T> {
  return locale === "fr-CA" ? catalogues["fr-CA"] : catalogues.en;
}

/** Replaces `{name}` placeholders; an unknown placeholder is left visible. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Every leaf of a catalogue, as dotted paths, for completeness tests. */
export function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}
