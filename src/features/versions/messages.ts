import type { Locale } from "@/lib/i18n/config";
import { pickCatalogue } from "@/features/collab/i18n";
import { versionsEn } from "./messages.en";
import { versionsFr } from "./messages.fr-CA";

export const versionsCatalogues = { en: versionsEn, "fr-CA": versionsFr };

export function versionsText(locale: Locale) {
  return pickCatalogue(versionsCatalogues, locale);
}

export type VersionsText = ReturnType<typeof versionsText>;
