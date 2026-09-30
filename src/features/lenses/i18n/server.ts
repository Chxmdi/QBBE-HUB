import { getLocale } from "@/lib/i18n/server";
import { createLensT } from "./index";

export async function getLensT() {
  return createLensT(await getLocale());
}
