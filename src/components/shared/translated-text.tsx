"use client";

import { useT } from "@/lib/i18n/client";
import type { MessageKey, MessageVars } from "@/lib/i18n/translate";

/**
 * One catalogue string in the reader's language, for markup shared by server
 * and client components (a server component cannot call `useT`, and a shared
 * file cannot be async).
 */
export function TranslatedText({ k, vars }: { k: MessageKey; vars?: MessageVars }) {
  return <>{useT()(k, vars)}</>;
}
