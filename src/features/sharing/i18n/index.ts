import type { Locale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { moduleTranslator, type ModuleTranslate } from "@/features/spaces/i18n/translator";
import { sharingEn } from "./en";
import { sharingFr } from "./fr-CA";

export type SharingT = ModuleTranslate<typeof sharingEn>;

export function sharingT(locale: Locale): SharingT {
  return moduleTranslator<typeof sharingEn>({ en: sharingEn, "fr-CA": sharingFr }, locale);
}

export async function getSharingT(): Promise<SharingT> {
  return sharingT(await getLocale());
}
