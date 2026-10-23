import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server's markup and until React has taken the page over, then
 * true. A form's submit button waits for it: before then, the page cannot
 * handle the submit, and a click would be lost (or, without a handler, sent
 * by the browser as a plain GET with the fields in the address bar).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
