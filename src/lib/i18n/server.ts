import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSessionContext } from "@/lib/auth";
import {
  isLocale,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  type Locale,
} from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { formattersFor } from "@/lib/i18n/format";

/**
 * The language for this request, resolved once.
 *
 * Order: the person's saved choice, then the cookie (set when they choose on
 * the sign-in screen or in settings), then the browser's Accept-Language, then
 * English. The session lookup is the same cached call the workspace layout
 * makes, so signed-in pages pay nothing extra for it.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  try {
    const session = await getSessionContext();
    const saved = session?.profile.locale;
    if (isLocale(saved)) return saved;
  } catch {
    // A failed session read is handled, loudly, by the page that needs the
    // session. Choosing a language must not be what takes a page down.
  }

  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerList = await headers();
  return localeFromAcceptLanguage(headerList.get("accept-language"));
});

/** `t()` for server components, bound to this request's language. */
export async function getT() {
  return createTranslator(await getLocale());
}

/** Date, number and money formatters bound to this request's language. */
export async function getFormatters() {
  return formattersFor(await getLocale());
}
