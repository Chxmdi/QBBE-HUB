"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { mobileT } from "../i18n";

export function useMobileT() {
  const locale = useLocale();
  return useMemo(() => mobileT(locale), [locale]);
}
