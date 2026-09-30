import type { Locale } from "@/lib/i18n/config";
import { moduleTranslator } from "@/features/universal-tasks/i18n/module-i18n";
import { homeEn } from "./en";
import { homeFrCA } from "./fr-CA";

export const homeCatalogs = { en: homeEn, "fr-CA": homeFrCA };

export function homeT(locale: Locale) {
  return moduleTranslator(homeCatalogs, locale);
}
export type HomeT = ReturnType<typeof homeT>;
