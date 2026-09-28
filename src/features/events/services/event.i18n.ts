import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

/** Validation messages are catalogue keys, translated when the action returns. */
export const K = (key: MessageKey): string => key;

/** One message in the caller's language. */
export async function tr(key: MessageKey): Promise<string> {
  return (await getT())(key);
}

/**
 * A validation message in the caller's language. Our own messages are keys;
 * zod's built-in ones are English sentences, shown as they are in English and
 * replaced by a general message in French.
 */
export async function issueMessage(message: string | undefined): Promise<string> {
  const t = await getT();
  if (message?.startsWith("events.")) return t(message as MessageKey);
  if (message && (await getLocale()) === "en") return message;
  return t("events.errors.invalidInput");
}
