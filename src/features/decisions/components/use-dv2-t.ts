"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { decisionsV2T } from "../i18n";

/** This module's `t()` in the viewer's language, for client components. */
export function useDecisionsV2T() {
  const locale = useLocale();
  return useMemo(() => decisionsV2T(locale), [locale]);
}
