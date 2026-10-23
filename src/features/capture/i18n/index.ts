import type { Locale } from "@/lib/i18n/config";
import { moduleTranslator } from "@/features/universal-tasks/i18n/module-i18n";
import { catalogues } from "./catalogues";

const captureEn = catalogues.en;
const captureFrCA = catalogues["fr-CA"];

export const captureCatalogs = { en: captureEn, "fr-CA": captureFrCA };

export function captureT(locale: Locale) {
  return moduleTranslator(captureCatalogs, locale);
}
export type CaptureT = ReturnType<typeof captureT>;
