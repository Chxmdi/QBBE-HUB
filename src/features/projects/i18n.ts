import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";
import { isLocale } from "@/lib/i18n/config";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { portfolioEn } from "@/lib/i18n/messages/workspace/portfolio.en";

/**
 * Translation helpers for the portfolio screens (projects, programs, risks,
 * outcomes) — #141.
 *
 * The zod schemas keep their English sentences: tests pin them and other
 * modules parse with the same schemas. Each sentence also sits, word for word,
 * in a `validation` group of the portfolio catalogue, so a server action can
 * turn the English message back into its key and translate it.
 */

const EN = createTranslator("en");

const KEY_BY_ENGLISH = new Map<string, MessageKey>();
for (const ns of ["projects", "programs", "risks", "outcomes"] as const) {
  for (const [key, text] of Object.entries(portfolioEn[ns].validation)) {
    if (!KEY_BY_ENGLISH.has(text)) {
      KEY_BY_ENGLISH.set(text, `${ns}.validation.${key}` as MessageKey);
    }
  }
}

/**
 * The first zod issue, in the reader's language.
 *
 * A sentence the catalogue knows is translated. Anything else (a zod default
 * such as a length limit) is returned unchanged in English, so English stays
 * exactly as it was, and replaced by the generic fallback in other languages.
 */
export function localizeIssue(
  t: TranslateFn,
  message: string | undefined,
  fallback: MessageKey,
): string {
  if (!message) return t(fallback);
  const key = KEY_BY_ENGLISH.get(message);
  if (key) return t(key);
  return t(fallback) === EN(fallback) ? message : t(fallback);
}

type Roles = typeof portfolioEn.projects.access.roles;
type Sources = typeof portfolioEn.projects.access.sources;

/** A scoped access role (project or program grant) as a person reads it. */
export function accessRoleLabel(role: string, t: TranslateFn): string {
  return role in portfolioEn.projects.access.roles
    ? t(`projects.access.roles.${role as keyof Roles}`)
    : role.replaceAll("_", " ");
}

/** Where a scoped grant came from, as a person reads it. */
export function accessSourceLabel(source: string, t: TranslateFn): string {
  return source in portfolioEn.projects.access.sources
    ? t(`projects.access.sources.${source as keyof Sources}`)
    : source.replaceAll("_", " ");
}

/**
 * One translator per recipient, in the language each saved on their profile
 * (null means English). Used for notifications, which are read by somebody
 * other than the person whose request wrote them.
 */
export async function recipientTranslators(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userIds: string[],
): Promise<(userId: string) => TranslateFn> {
  const byUser = new Map<string, TranslateFn>();
  if (userIds.length > 0) {
    const { data } = await supabase.from("user_profile").select("id, locale").in("id", userIds);
    for (const row of (data ?? []) as { id: string; locale: string | null }[]) {
      if (isLocale(row.locale)) byUser.set(row.id, createTranslator(row.locale));
    }
  }
  return (userId) => byUser.get(userId) ?? EN;
}
