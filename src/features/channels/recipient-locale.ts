import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

/**
 * A translator per recipient, in the language each person saved (#141).
 *
 * Notifications are stored as text and read later by someone else, so they are
 * written in the recipient's language, not the sender's. No saved choice, or a
 * profile this client cannot read, means English, as before.
 */
export async function recipientTranslators(
  db: SupabaseClient,
  userIds: string[],
): Promise<(userId: string) => TranslateFn> {
  const locales = new Map<string, Locale>();
  const ids = [...new Set(userIds)];
  // Chunked so an organization-wide announcement stays within URL limits.
  for (let index = 0; index < ids.length; index += 100) {
    const { data } = await db
      .from("user_profile")
      .select("id, locale")
      .in("id", ids.slice(index, index + 100));
    for (const row of (data ?? []) as { id: string; locale: string | null }[]) {
      if (isLocale(row.locale)) locales.set(row.id, row.locale);
    }
  }
  const translators = new Map<Locale, TranslateFn>();
  return (userId) => {
    const locale = locales.get(userId) ?? DEFAULT_LOCALE;
    let t = translators.get(locale);
    if (!t) {
      t = createTranslator(locale);
      translators.set(locale, t);
    }
    return t;
  };
}
