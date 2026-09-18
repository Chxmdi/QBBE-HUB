/**
 * The origin the browser actually arrived on, for redirects that must keep a
 * session usable.
 *
 * `new URL(request.url).origin` is the server's view of itself, and it does not
 * have to match the host in the address bar — behind a proxy it is the internal
 * address, and even a plain `next start -H 127.0.0.1` reports `localhost`. That
 * difference is not cosmetic after an auth code exchange: the session cookie
 * belongs to the host the browser used, so redirecting to a different spelling
 * of the same server lands the user on a page that cannot see their new
 * session — recovery then reports "your recovery session is missing or has
 * expired" with a valid session sitting one hostname away.
 *
 * The forwarded host only ever chooses between spellings of this application.
 * Redirect paths are constrained separately by safeRedirectPath, so a forged
 * header cannot turn a redirect into one that carries the user, or anything of
 * theirs, to somebody else's content.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return url.origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}
