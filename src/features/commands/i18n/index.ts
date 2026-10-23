import type { Locale } from "@/lib/i18n/config";
import { moduleTranslator } from "@/features/universal-tasks/i18n/module-i18n";
import { catalogues } from "./catalogues";

const commandsEn = catalogues.en;
const commandsFrCA = catalogues["fr-CA"];

export const commandsCatalogs = { en: commandsEn, "fr-CA": commandsFrCA };

export function commandsT(locale: Locale) {
  return moduleTranslator(commandsCatalogs, locale);
}
