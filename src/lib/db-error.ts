import { logActionFailure } from "@/lib/server-log";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translator";

/**
 * Database errors as people read them.
 *
 * The database raises its refusals as English sentences. An action must not
 * show them as they are: the reader may read French, and not every message is
 * written for people (row-level security, permission and constraint errors
 * name tables and policies). Each module lists the sentences people can meet
 * with a catalogue key; a listed sentence is shown translated, anything else
 * becomes the action's own generic message and is logged for the operators.
 *
 * The result is always an error message: this never turns a refusal into
 * success, it only chooses the words.
 */

export type DbError = { code?: string | null; message: string; hint?: string | null } | null | undefined;

export type DbErrorRule = {
  key: MessageKey;
  /** The whole sentence, anchored; groups capture the values it carries. */
  pattern: RegExp;
  /** The catalogue placeholder for each group, in order. */
  params?: readonly string[];
  /** Translates a value the database writes in English, by placeholder. */
  values?: Readonly<Record<string, (value: string, t: TranslateFn) => string>>;
};

// Text written for the database's operators, never for people, whatever rule
// might otherwise match it.
const INTERNAL = /row-level security|permission denied/i;

/** The translated sentence for a listed refusal, or null. */
export function knownDbErrorMessage(t: TranslateFn, error: DbError, rules: readonly DbErrorRule[]): string | null {
  if (!error?.message || INTERNAL.test(error.message)) return null;
  for (const rule of rules) {
    const match = rule.pattern.exec(error.message);
    if (!match) continue;
    const vars: Record<string, string> = {};
    rule.params?.forEach((name, index) => {
      const value = match[index + 1] ?? "";
      vars[name] = rule.values?.[name]?.(value, t) ?? value;
    });
    return t(rule.key, vars);
  }
  return null;
}

/**
 * The message to show for a database error: the translated sentence when the
 * refusal is listed, otherwise `fallback`, with the original logged.
 */
export function dbErrorMessage(
  t: TranslateFn,
  error: DbError,
  fallback: string,
  options: { action: string; rules: readonly DbErrorRule[] },
): string {
  if (!error) return fallback;
  const known = knownDbErrorMessage(t, error, options.rules);
  if (known) return known;
  logActionFailure(options.action, error);
  return fallback;
}
