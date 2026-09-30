import type { Locale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { moduleTranslator, type ModuleTranslate } from "@/features/spaces/i18n/translator";
import { publicPagesEn } from "./en";
import { publicPagesFr } from "./fr-CA";

export type PublicPagesT = ModuleTranslate<typeof publicPagesEn>;

export function publicPagesT(locale: Locale): PublicPagesT {
  return moduleTranslator<typeof publicPagesEn>({ en: publicPagesEn, "fr-CA": publicPagesFr }, locale);
}

export async function getPublicPagesT(): Promise<PublicPagesT> {
  return publicPagesT(await getLocale());
}
