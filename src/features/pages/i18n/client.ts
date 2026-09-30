"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { createPagesT, type PagesT } from "./index";

/** The pages module's `t()` in client components. */
export function usePagesT(): PagesT {
  const locale = useLocale();
  return useMemo(() => createPagesT(locale), [locale]);
}
