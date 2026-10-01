"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { createObjectsTranslator, type ObjectsT } from "./catalog";

/** `t()` for this module's client components, in the viewer's language. */
export function useObjectsT(): ObjectsT {
  const locale = useLocale();
  return useMemo(() => createObjectsTranslator(locale), [locale]);
}
