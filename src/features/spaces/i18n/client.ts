"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { catalogues } from "./catalogues";
import { moduleTranslator, type ModuleTranslate } from "./translator";

const spacesEn = catalogues.en;
const spacesFr = catalogues["fr-CA"];

/** `t()` for spaces client components, in the reader's language. */
export function useSpacesT(): ModuleTranslate<typeof spacesEn> {
  const locale = useLocale();
  return useMemo(
    () => moduleTranslator<typeof spacesEn>({ en: spacesEn, "fr-CA": spacesFr }, locale),
    [locale],
  );
}
