import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { formattersFor } from "@/lib/i18n/format";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Language helpers for the job runtime (#141).
 *
 * A job has no request, so no cookie: text written to a person uses that
 * person's saved `user_profile.locale` (null means English). Run logs and
 * errors stay English — they are for developers.
 */

const CHUNK = 200;

/**
 * Each person's saved language, by user id. Anyone missing, or a failed read,
 * gets English: a reminder in the wrong language beats no reminder at all.
 */
export async function recipientLocales(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, Locale>> {
  const locales = new Map<string, Locale>();
  const ids = [...new Set(userIds)];
  for (let index = 0; index < ids.length; index += CHUNK) {
    const { data, error } = await db
      .from("user_profile")
      .select("id, locale")
      .in("id", ids.slice(index, index + CHUNK));
    if (error) continue;
    for (const row of (data ?? []) as { id: string; locale: string | null }[]) {
      if (isLocale(row.locale)) locales.set(row.id, row.locale);
    }
  }
  return locales;
}

/** `t()` per language, built once per run rather than once per draft. */
export function translators() {
  const cache = new Map<Locale, TranslateFn>();
  return (locale: Locale = DEFAULT_LOCALE): TranslateFn => {
    let t = cache.get(locale);
    if (!t) {
      t = createTranslator(locale);
      cache.set(locale, t);
    }
    return t;
  };
}

/**
 * A calendar date ("YYYY-MM-DD") inside a notification. English keeps the
 * ISO date it has always shown; French reads "28 sept. 2026". The date has
 * no time, so it is formatted at noon UTC to stay on the same day.
 */
export function reminderDate(isoDate: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return isoDate;
  return formattersFor(locale).date(`${isoDate.slice(0, 10)}T12:00:00Z`, "UTC");
}

/** A job's description in the reader's language, or the stored text for an unknown job. */
export function jobDescription(name: string, stored: string, t: TranslateFn): string {
  return name in opsEn.jobs.descriptions
    ? t(`jobs.descriptions.${name}` as MessageKey)
    : stored;
}
