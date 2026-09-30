"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { moduleTranslator, type ModuleTranslate } from "@/features/spaces/i18n/translator";
import { sharingEn } from "./en";
import { sharingFr } from "./fr-CA";

export function useSharingT(): ModuleTranslate<typeof sharingEn> {
  const locale = useLocale();
  return useMemo(() => moduleTranslator<typeof sharingEn>({ en: sharingEn, "fr-CA": sharingFr }, locale), [locale]);
}
