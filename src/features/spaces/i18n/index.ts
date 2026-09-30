import type { Locale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { spacesEn } from "./en";
import { spacesFr } from "./fr-CA";
import { moduleTranslator, type ModuleTranslate } from "./translator";

export type SpacesT = ModuleTranslate<typeof spacesEn>;

export const spacesCatalogues = { en: spacesEn, "fr-CA": spacesFr } as const;

export function spacesT(locale: Locale): SpacesT {
  return moduleTranslator<typeof spacesEn>(spacesCatalogues, locale);
}

/** `t()` for the spaces screens, in this request's language. */
export async function getSpacesT(): Promise<SpacesT> {
  return spacesT(await getLocale());
}
