import { getLocale } from "@/lib/i18n/server";
import { createPagesT, type PagesT } from "./index";

/** The pages module's `t()` for this request's language (server only). */
export async function getPagesT(): Promise<PagesT> {
  return createPagesT(await getLocale());
}
