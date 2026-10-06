import { getLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { createObjectsTranslator, type ObjectsT } from "./catalog";

export { createObjectsTranslator } from "./catalog";
export type { ObjectsKey, ObjectsT } from "./catalog";

/** `t()` for this module's server components, in the request's language. */
export async function getObjectsT(): Promise<{ t: ObjectsT; locale: Locale }> {
  const locale = await getLocale();
  return { t: createObjectsTranslator(locale), locale };
}
