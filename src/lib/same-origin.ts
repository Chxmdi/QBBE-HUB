import { NextResponse } from "next/server";
import { requestOrigin } from "./request-origin";

/**
 * Cross-site request forgery guard for route handlers that act on the
 * session cookie.
 *
 * A browser sends the cookie with any request it makes to the Hub, including
 * one a hostile page triggers with a form or `fetch`. For those requests the
 * browser also states where the request came from: the `Origin` header on
 * every cross-site POST, and `Referer` as a fallback for the few agents that
 * omit it. A request whose stated source is not this application is refused
 * before anything is read or written.
 *
 * Server actions carry their own check in Next.js; this is for the plain
 * `/api` POST routes, which do not.
 */
export function isSameOriginRequest(request: Request): boolean {
  const expected = requestOrigin(request);
  const stated = request.headers.get("origin") ?? refererOrigin(request.headers.get("referer"));
  // Neither header: not a browser form or fetch, so not a cross-site browser
  // request either. A session cookie cannot be attached to such a request by
  // a third party's page, which is the attack this guard exists for.
  if (stated === null) return true;
  return sameOrigin(stated, expected);
}

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return "null";
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The answer a refused cross-site request gets: 403, no detail about the session. */
export function crossSiteResponse(): NextResponse {
  return NextResponse.json({ error: "cross_site_request" }, { status: 403 });
}
