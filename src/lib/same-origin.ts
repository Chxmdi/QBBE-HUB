import { NextResponse } from "next/server";
import { requestOrigin } from "@/lib/request-origin";

/**
 * Whether a cookie-authenticated request came from this application's own
 * pages, so that a page somewhere else cannot make a signed-in browser act on
 * its behalf (cross-site request forgery).
 *
 * Browsers say where a request came from in two ways. `Sec-Fetch-Site` is the
 * newer one: every current browser sends it and no page can change it.
 * `Origin` is the older one, sent with every POST. A request that carries
 * neither did not come from a web page (a command-line tool, a server-side
 * job), and such a client never carries the browser's session cookie, so it
 * is let through: the cookie is what this check protects.
 *
 * Server Actions get the same check from Next.js itself. Route handlers do
 * not, which is why this exists for the ones that act on the session cookie.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin.toLowerCase() === requestOrigin(request).toLowerCase();
}

/** The refusal a route handler returns when the request is not from this site. */
export function crossSiteResponse(): NextResponse {
  return NextResponse.json({ error: "cross_site" }, { status: 403 });
}
