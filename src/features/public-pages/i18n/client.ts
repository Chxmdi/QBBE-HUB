"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { moduleTranslator, type ModuleTranslate } from "@/features/spaces/i18n/translator";
import { publicPagesEn } from "./en";
import { publicPagesFr } from "./fr-CA";

export function usePublicPagesT(): ModuleTranslate<typeof publicPagesEn> {
  const locale = useLocale();
  return useMemo(() => moduleTranslator<typeof publicPagesEn>({ en: publicPagesEn, "fr-CA": publicPagesFr }, locale), [locale]);
}
