import { decisionsV2En } from "./en";
import { decisionsV2FrCA } from "./fr-CA";

/**
 * Both languages, which server code reads synchronously. The browser build
 * uses catalogues.browser.ts instead, which downloads only the page's
 * language (src/lib/i18n/lazy-catalogues.ts, PERF-004).
 */
export const catalogues = { en: decisionsV2En, "fr-CA": decisionsV2FrCA };
