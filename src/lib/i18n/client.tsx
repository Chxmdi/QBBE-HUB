"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";
import { formattersFor, type Formatters } from "@/lib/i18n/format";

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
  format: Formatters;
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
  format: formattersFor(DEFAULT_LOCALE),
});

/**
 * Hands the server-resolved language to client components, so the first
 * client render matches the server's and nothing flickers between languages.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(locale), format: formattersFor(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): TranslateFn {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useFormatters(): Formatters {
  return useContext(I18nContext).format;
}
