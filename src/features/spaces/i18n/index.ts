import type { Locale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { catalogues } from "./catalogues";
import { moduleTranslator, type ModuleTranslate } from "./translator";

const spacesEn = catalogues.en;
const spacesFr = catalogues["fr-CA"];

export type SpacesT = ModuleTranslate<typeof spacesEn>;

export const spacesCatalogues = { en: spacesEn, "fr-CA": spacesFr } as const;

export function spacesT(locale: Locale): SpacesT {
  return moduleTranslator<typeof spacesEn>(spacesCatalogues, locale);
}

/** `t()` for the spaces screens, in this request's language. */
export async function getSpacesT(): Promise<SpacesT> {
  return spacesT(await getLocale());
}
