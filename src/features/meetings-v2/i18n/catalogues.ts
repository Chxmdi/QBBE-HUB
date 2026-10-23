import { meetingsV2En } from "./en";
import { meetingsV2FrCA } from "./fr-CA";

/**
 * Both languages, which server code reads synchronously. The browser build
 * uses catalogues.browser.ts instead, which downloads only the page's
 * language (src/lib/i18n/lazy-catalogues.ts, PERF-004).
 */
export const catalogues = { en: meetingsV2En, "fr-CA": meetingsV2FrCA };
