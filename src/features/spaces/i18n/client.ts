"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { spacesEn } from "./en";
import { spacesFr } from "./fr-CA";
import { moduleTranslator, type ModuleTranslate } from "./translator";

/** `t()` for spaces client components, in the reader's language. */
export function useSpacesT(): ModuleTranslate<typeof spacesEn> {
  const locale = useLocale();
  return useMemo(
    () => moduleTranslator<typeof spacesEn>({ en: spacesEn, "fr-CA": spacesFr }, locale),
    [locale],
  );
}
