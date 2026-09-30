import type { Locale } from "@/lib/i18n/config";
import { pickCatalogue } from "./i18n";
import { collabEn } from "./messages.en";
import { collabFr } from "./messages.fr-CA";

export const collabCatalogues = { en: collabEn, "fr-CA": collabFr };

export function collabText(locale: Locale) {
  return pickCatalogue(collabCatalogues, locale);
}

export type CollabText = ReturnType<typeof collabText>;
