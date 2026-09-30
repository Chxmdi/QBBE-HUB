"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { createLensT } from "./index";

export function useLensT() {
  const locale = useLocale();
  return useMemo(() => createLensT(locale), [locale]);
}
