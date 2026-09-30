"use client";

import { useMemo } from "react";
import { useLocale } from "@/lib/i18n/client";
import { createEditorT, type EditorT } from "./index";

export function useEditorT(): EditorT {
  const locale = useLocale();
  return useMemo(() => createEditorT(locale), [locale]);
}
