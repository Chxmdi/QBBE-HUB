"use client";

import { createContext, use, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { translatorFor, type Messages, type TranslateFn } from "@/lib/i18n/translator";
import { formattersWith, type Formatters } from "@/lib/i18n/format-core";

interface I18nValue {
  locale: Locale;
  t: TranslateFn;
  format: Formatters;
}

// Outside a provider there is no catalogue to read. Every page is inside one
// (the root layout), so this only shows keys in an isolated test render.
const keysOnly: TranslateFn = (key) => key;

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: keysOnly,
  format: formattersWith(DEFAULT_LOCALE, keysOnly),
});

/**
 * Each language's catalogue is its own on-demand file. Importing both here
 * (or rendering one provider per language from the root layout, which Next.js
 * bundles together) put both languages in every page, about 183 KB
 * compressed. One promise per language, shared by every render.
 */
const loaders: Record<Locale, () => Promise<Messages>> = {
  en: () => import("@/lib/i18n/messages/en").then((m) => m.en),
  "fr-CA": () => import("@/lib/i18n/messages/fr-CA").then((m) => m.frCA),
};
const catalogues = new Map<Locale, Promise<Messages>>();

function catalogueFor(locale: Locale): Promise<Messages> {
  let pending = catalogues.get(locale);
  if (!pending) {
    pending = (loaders[locale] ?? loaders[DEFAULT_LOCALE])();
    catalogues.set(locale, pending);
  }
  return pending;
}

/**
 * Hands the server-resolved language to client components, so the first
 * client render matches the server's and nothing flickers between languages.
 * The server renders with the catalogue already loaded; in the browser the
 * page hydrates once the active language's file has arrived.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const catalog = use(catalogueFor(locale));
  const value = useMemo(() => {
    const t = translatorFor(catalog);
    return { locale, t, format: formattersWith(locale, t) };
  }, [locale, catalog]);
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
