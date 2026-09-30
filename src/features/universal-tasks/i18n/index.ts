import type { Locale } from "@/lib/i18n/config";
import { moduleTranslator } from "./module-i18n";
import { universalTasksEn } from "./en";
import { universalTasksFrCA } from "./fr-CA";

export const universalTasksCatalogs = { en: universalTasksEn, "fr-CA": universalTasksFrCA };

export function universalTasksT(locale: Locale) {
  return moduleTranslator(universalTasksCatalogs, locale);
}
