/**
 * Interface languages (#141).
 *
 * English stays the default so an unset preference behaves exactly as the Hub
 * always has. French is Quebec French specifically: dates, numbers and money
 * follow `fr-CA` conventions, not France's.
 */
export const LOCALES = ["en", "fr-CA"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Remembers the choice before sign-in and on devices where the profile has not
 * been read yet. The profile, when there is one, always wins.
 */
export const LOCALE_COOKIE = "qbbe-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks a supported language from an `Accept-Language` header.
 *
 * Any French variant maps to `fr-CA`: a browser set to `fr-FR` is still a
 * French speaker, and Quebec French is the only French the Hub has. Tags are
 * taken in the browser's preference order, ignoring those with `q=0`.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const tags = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isNaN(weight) ? 0 : weight, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const { tag } of tags) {
    if (tag === "fr" || tag.startsWith("fr-")) return "fr-CA";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return DEFAULT_LOCALE;
}

/** The BCP 47 tag handed to `Intl` for a supported language. */
export function intlLocale(locale: Locale): "en-CA" | "fr-CA" {
  return locale === "fr-CA" ? "fr-CA" : "en-CA";
}

/** The value for `<html lang>`. */
export function htmlLang(locale: Locale): string {
  return locale === "fr-CA" ? "fr-CA" : "en";
}
