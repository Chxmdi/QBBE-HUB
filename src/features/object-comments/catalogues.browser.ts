import { lazyCatalogues } from "@/lib/i18n/lazy-catalogues";
import type { catalogues as bothLanguages } from "./catalogues";

/** The browser's catalogues: only the page's language is downloaded (PERF-004). */
export const catalogues: typeof bothLanguages = lazyCatalogues<typeof bothLanguages>({
  en: () => import("./messages.en").then((m) => m.objectCommentsEn),
  "fr-CA": () => import("./messages.fr-CA").then((m) => m.objectCommentsFr),
});
