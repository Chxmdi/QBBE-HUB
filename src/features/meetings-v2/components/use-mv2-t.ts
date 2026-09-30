"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { meetingsV2T } from "../i18n";

/** This module's `t()` in the viewer's language, for client components. */
export function useMeetingsV2T() {
  const locale = useLocale();
  return useMemo(() => meetingsV2T(locale), [locale]);
}
