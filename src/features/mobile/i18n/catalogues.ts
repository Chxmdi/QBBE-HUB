import { mobileEn } from "./en";
import { mobileFrCA } from "./fr-CA";

/**
 * Both languages, which server code reads synchronously. The browser build
 * uses catalogues.browser.ts instead, which downloads only the page's
 * language (src/lib/i18n/lazy-catalogues.ts, PERF-004).
 */
export const catalogues = { en: mobileEn, "fr-CA": mobileFrCA };
