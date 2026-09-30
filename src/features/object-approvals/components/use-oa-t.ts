"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { objectApprovalsT } from "../i18n";

export function useObjectApprovalsT() {
  const locale = useLocale();
  return useMemo(() => objectApprovalsT(locale), [locale]);
}
