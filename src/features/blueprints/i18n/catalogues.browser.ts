import { lazyCatalogues } from "@/lib/i18n/lazy-catalogues";
import type { catalogues as bothLanguages } from "./catalogues";

/** The browser's catalogues: only the page's language is downloaded (PERF-004). */
export const catalogues: typeof bothLanguages = lazyCatalogues<typeof bothLanguages>({
  en: () => import("./en").then((m) => m.blueprintsEn),
  "fr-CA": () => import("./fr-CA").then((m) => m.blueprintsFrCA),
});
