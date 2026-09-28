import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  DEFAULT_LOCALE,
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
 * Order: the `qbbe-locale` cookie, then the browser's Accept-Language, then
 * English. Neither needs a network call. This runs in the root layout and in
 * every page's metadata, and reading the session here cost each page an Auth
 * round trip and a membership query: CI's signed-in sweeps ran about 1.5x
 * slower than main until it went.
 *
 * The saved profile choice is still the record. Saving it writes the cookie
 * too, and `LocaleSync` in the workspace re-syncs the cookie from the profile
 * on a device that does not have it yet.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  let jar: Awaited<ReturnType<typeof cookies>>;
  let headerList: Awaited<ReturnType<typeof headers>>;
  try {
    jar = await cookies();
    headerList = await headers();
  } catch {
    // Outside a request (a unit test, a script) there is no one to ask, so
    // shared service code that calls `getT()` falls back to English. Jobs
    // writing to a person use that person's saved language instead.
    return DEFAULT_LOCALE;
  }
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
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
