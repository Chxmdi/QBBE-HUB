import type { Locale } from "@/lib/i18n/config";
import { pickCatalogue } from "@/features/collab/i18n";
import { layoutsEn } from "./messages.en";
import { layoutsFr } from "./messages.fr-CA";

export const layoutsCatalogues = { en: layoutsEn, "fr-CA": layoutsFr };

export function layoutsText(locale: Locale) {
  return pickCatalogue(layoutsCatalogues, locale);
}

export type LayoutsText = ReturnType<typeof layoutsText>;

/** A property's or relation's name, falling back to its key for custom ones. */
export function labelFor(group: Record<string, string>, key: string): string {
  return group[key] ?? key.replace(/_/g, " ");
}
