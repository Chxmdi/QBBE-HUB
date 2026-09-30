import type { Locale } from "@/lib/i18n/config";
import { pickCatalogue } from "@/features/collab/i18n";
import { objectCommentsEn } from "./messages.en";
import { objectCommentsFr } from "./messages.fr-CA";

export const objectCommentsCatalogues = { en: objectCommentsEn, "fr-CA": objectCommentsFr };

export function objectCommentsText(locale: Locale) {
  return pickCatalogue(objectCommentsCatalogues, locale);
}

export type ObjectCommentsText = ReturnType<typeof objectCommentsText>;
