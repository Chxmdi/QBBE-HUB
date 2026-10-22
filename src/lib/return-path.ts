/**
 * Where a person was going when they had to sign in or verify first.
 *
 * Links in emails carry their target in the query string (/my-work?task=…,
 * /channels/…?thread=…). Only the path used to survive sign-in, and
 * two-step verification kept nothing, so the person landed on a generic
 * page. The full path and query string now travel in `next`; whoever reads
 * it still passes it through safeRedirectPath.
 */

/** The request header the middleware uses to tell pages the current path and query. */
export const RETURN_PATH_HEADER = "x-qbbe-return-path";

/** The path and query string to come back to. */
export function returnPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/** The sign-in address for a signed-out request to `url`. */
export function signInUrl(url: URL): URL {
  const target = new URL("/sign-in", url);
  target.searchParams.set("next", returnPath(url));
  return target;
}

/** The two-step verification address that returns to `back` afterwards. */
export function mfaPath(back: string | null | undefined): string {
  // Only a plain in-app path; /mfa still runs it through safeRedirectPath.
  return back && back.startsWith("/") && !back.startsWith("//") && !back.includes("\\")
    && back !== "/" && !back.startsWith("/mfa")
    ? `/mfa?next=${encodeURIComponent(back)}`
    : "/mfa";
}
