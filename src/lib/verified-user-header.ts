/**
 * The user the request proxy has just verified with Supabase Auth, handed to
 * server components on the forwarded request (#115).
 *
 * Every page used to ask Auth who the user was twice: once in the proxy, to
 * gate the route, and again in getSessionContext. Under 50 users the single
 * Next.js process was the bottleneck, and each duplicate call was a network
 * round trip it had to wait on and parse.
 *
 * The header is trustworthy only because the proxy removes any incoming copy
 * on every request it handles, and sets it only after `auth.getUser()` has
 * verified the session with Auth. The proxy runs on every path except static
 * assets. Data access does not depend on it: row-level security still reads
 * the caller from the session token on each database request.
 */
export const VERIFIED_USER_HEADER = "x-qbbe-verified-user";

export interface VerifiedUser {
  id: string;
  email: string;
}

export function encodeVerifiedUser(user: VerifiedUser): string {
  return encodeURIComponent(JSON.stringify({ id: user.id, email: user.email }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeVerifiedUser(value: string | null): VerifiedUser | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<VerifiedUser>;
    if (typeof parsed.id !== "string" || !UUID.test(parsed.id)) return null;
    return { id: parsed.id, email: typeof parsed.email === "string" ? parsed.email : "" };
  } catch {
    return null;
  }
}
