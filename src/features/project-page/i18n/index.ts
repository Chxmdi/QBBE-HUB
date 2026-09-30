import type { Locale } from "@/lib/i18n/config";
import { moduleTranslator } from "@/features/universal-tasks/i18n/module-i18n";
import { projectPageEn } from "./en";
import { projectPageFrCA } from "./fr-CA";

export const projectPageCatalogs = { en: projectPageEn, "fr-CA": projectPageFrCA };

export function projectPageT(locale: Locale) {
  return moduleTranslator(projectPageCatalogs, locale);
}
export type ProjectPageT = ReturnType<typeof projectPageT>;
