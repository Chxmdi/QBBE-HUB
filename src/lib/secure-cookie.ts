import { headers } from "next/headers";

/**
 * Whether a cookie set on this request should be marked Secure (sent over
 * HTTPS only): true when the request itself came over HTTPS.
 *
 * Deciding this from the build mode marked cookies Secure on a production
 * build served over plain http (the browser tests' http://127.0.0.1).
 * Chromium and Firefox accept that on a local address; WebKit refuses the
 * cookie, so a choice such as the interface language never stuck there.
 * Hosted environments are HTTPS and say so in X-Forwarded-Proto.
 */
export async function cookieShouldBeSecure(): Promise<boolean> {
  const requestHeaders = await headers();
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  // No proxy in front: a local address is plain http; anything else in a
  // production build is assumed to be behind HTTPS.
  const host = (requestHeaders.get("host") ?? "").toLowerCase();
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
  return process.env.NODE_ENV === "production";
}
